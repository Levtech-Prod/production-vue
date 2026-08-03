// Revision documents (document-system-plan.md, Stories 1–2).
//
// Both product and sub-product documents now hang off a REVISION and point at a
// row in `stored_files` rather than owning their bytes, so the same file can be
// shared by several revisions. The sharing rules — carry-forward, copy-on-write
// and the stateless cleanup check — live in `services/documentFiles.ts`; this
// file is the HTTP surface over them.
//
// The two families are structurally identical, so each verb is written once
// against a `DocumentScope` and the routes below are thin parameter-parsing
// wrappers. Story 5 replaces the flat GET with the grouped payload (per document
// type + status + summary), adds `documentTypeId` to upload/replace, and adds
// the forced-download endpoints.
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  documentUploadSchema,
  type DocumentUploadPayload,
} from '../schemas/documents.schema.js';
import {
  deleteDocument,
  documentsDir,
  findEntityForRevision,
  insertDocument,
  insertStoredFile,
  listDocuments,
  placeUpload,
  publicPath,
  repointDocument,
  resolveEntityFolder,
  safeUnlink,
  unlinkStoredFile,
  type DocumentRow,
  type DocumentScope,
} from '../services/documentFiles.js';

const router = Router();

// ── Upload handling ────────────────────────────────────────────────────────

// Files first land in the base documents folder under a temporary name; the
// handler moves them into the owning entity's folder once it is resolved.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, documentsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

// Story 5 widens this for engineering formats (.step, .hex, .elf, .pcbdoc, …)
// and adds the per-document-type extension allow-list on top.
const allowedMimeTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type'));
    }
    cb(null, true);
  },
});

// ── Response shape ─────────────────────────────────────────────────────────

function docResponse(row: DocumentRow) {
  return {
    id: row.id,
    documentTypeId: row.document_type_id,
    originalName: row.original_name,
    filename: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    path: publicPath(row.storage_key),
    createdAt: row.created_at,
  };
}

// ── Shared handlers ────────────────────────────────────────────────────────

/**
 * Store an uploaded file in the revision's owning entity folder and record it
 * as a new document row. The `stored_files` row and the document row are
 * inserted in one transaction; if it fails, the file just written is removed
 * again so a rolled-back upload leaves nothing behind.
 */
async function handleUpload(
  res: Response,
  scope: DocumentScope,
  revisionId: number,
  file: Express.Multer.File,
  customName: string | undefined,
  userId: number | null,
) {
  const entity = await findEntityForRevision(pool, scope, revisionId);
  if (!entity) {
    safeUnlink(file.path);
    return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
  }

  const folder = resolveEntityFolder(scope, entity.id, entity.name, entity.sku);
  const placed = placeUpload(file, folder, customName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const storedFileId = await insertStoredFile(client, {
      storageKey: placed.storageKey,
      sizeBytes: file.size,
      mimeType: file.mimetype,
    });
    const row = await insertDocument(client, scope, {
      revisionId,
      storedFileId,
      originalName: placed.displayName,
      uploadedBy: userId,
    });
    await client.query('COMMIT');
    res.status(201).json(docResponse(row));
  } catch (err) {
    await client.query('ROLLBACK');
    unlinkStoredFile(placed.storageKey);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Copy-on-write replace: store the incoming file as a NEW stored file and
 * repoint only this revision's row at it. Any other revision that was sharing
 * the previous file keeps it unchanged; the previous file is unlinked only if
 * this row was the last reference — and only after the transaction commits,
 * since an unlink cannot be rolled back.
 */
async function handleReplace(
  res: Response,
  scope: DocumentScope,
  revisionId: number,
  docId: number,
  file: Express.Multer.File,
  customName: string | undefined,
) {
  const entity = await findEntityForRevision(pool, scope, revisionId);
  if (!entity) {
    safeUnlink(file.path);
    return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
  }

  const folder = resolveEntityFolder(scope, entity.id, entity.name, entity.sku);
  const placed = placeUpload(file, folder, customName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const storedFileId = await insertStoredFile(client, {
      storageKey: placed.storageKey,
      sizeBytes: file.size,
      mimeType: file.mimetype,
    });
    const result = await repointDocument(client, scope, {
      revisionId,
      docId,
      storedFileId,
      originalName: placed.displayName,
    });
    if (!result) {
      await client.query('ROLLBACK');
      unlinkStoredFile(placed.storageKey);
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_NOT_FOUND });
    }
    await client.query('COMMIT');
    unlinkStoredFile(result.orphanKey);
    res.json(docResponse(result.row));
  } catch (err) {
    await client.query('ROLLBACK');
    unlinkStoredFile(placed.storageKey);
    throw err;
  } finally {
    client.release();
  }
}

/** Delete one revision's document row, unlinking the file only if unshared. */
async function handleDelete(
  res: Response,
  scope: DocumentScope,
  revisionId: number,
  docId: number,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { found, orphanKey } = await deleteDocument(client, scope, revisionId, docId);
    if (!found) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_NOT_FOUND });
    }
    await client.query('COMMIT');
    unlinkStoredFile(orphanKey);
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Parameter parsing ──────────────────────────────────────────────────────

/** Parse a positive integer route param, or null when it isn't one. */
function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Validate the multipart text fields. Multer has already written the file to
 * disk by this point, so a rejected body takes the temp file with it rather
 * than leaving it behind.
 */
function parseUploadBody(req: Request): DocumentUploadPayload {
  try {
    return documentUploadSchema.parse(req.body ?? {});
  } catch (err) {
    if (req.file) safeUnlink(req.file.path);
    throw err;
  }
}

/**
 * Sub-product document routes carry the sub-product id as well as the revision
 * id. Confirm the revision really belongs to that sub-product so a valid
 * revision id under the wrong parent is a 404, not a silent cross-read.
 */
async function spRevisionBelongsTo(spId: number, revId: number): Promise<boolean> {
  const entity = await findEntityForRevision(pool, 'subProduct', revId);
  return entity?.id === spId;
}

// ── Product revision documents ─────────────────────────────────────────────

// GET /api/product-revisions/:revId/documents
router.get('/product-revisions/:revId/documents', requireAuth, async (req, res) => {
  const revId = parseId(req.params.revId);
  if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });

  const rows = await listDocuments(pool, 'product', revId);
  res.json(rows.map(docResponse));
});

// POST /api/product-revisions/:revId/documents — multipart upload
router.post(
  '/product-revisions/:revId/documents',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const revId = parseId(req.params.revId);
    if (!revId) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    }
    if (!req.file) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });

    const { name } = parseUploadBody(req);
    return handleUpload(res, 'product', revId, req.file, name, req.user?.id ?? null);
  },
);

// PUT /api/product-revisions/:revId/documents/:docId — replace (copy-on-write)
router.put(
  '/product-revisions/:revId/documents/:docId',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const revId = parseId(req.params.revId);
    const docId = parseId(req.params.docId);
    if (!revId || !docId) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({
        code: revId ? ErrorCodes.INVALID_DOCUMENT_ID : ErrorCodes.INVALID_REVISION_ID,
      });
    }
    if (!req.file) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });

    const { name } = parseUploadBody(req);
    return handleReplace(res, 'product', revId, docId, req.file, name);
  },
);

// DELETE /api/product-revisions/:revId/documents/:docId
router.delete('/product-revisions/:revId/documents/:docId', requireAuth, async (req, res) => {
  const revId = parseId(req.params.revId);
  const docId = parseId(req.params.docId);
  if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  if (!docId) return res.status(400).json({ code: ErrorCodes.INVALID_DOCUMENT_ID });

  return handleDelete(res, 'product', revId, docId);
});

// ── Sub-product revision documents ─────────────────────────────────────────

// GET /api/sub-products/:spId/revisions/:revId/documents
router.get(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  async (req, res) => {
    const spId = parseId(req.params.spId);
    const revId = parseId(req.params.revId);
    if (!spId) return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
    if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    if (!(await spRevisionBelongsTo(spId, revId))) {
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    const rows = await listDocuments(pool, 'subProduct', revId);
    res.json(rows.map(docResponse));
  },
);

// POST /api/sub-products/:spId/revisions/:revId/documents
router.post(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const spId = parseId(req.params.spId);
    const revId = parseId(req.params.revId);
    if (!spId || !revId) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({
        code: spId ? ErrorCodes.INVALID_REVISION_ID : ErrorCodes.INVALID_SUB_PRODUCT_ID,
      });
    }
    if (!req.file) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });
    if (!(await spRevisionBelongsTo(spId, revId))) {
      safeUnlink(req.file.path);
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    const { name } = parseUploadBody(req);
    return handleUpload(res, 'subProduct', revId, req.file, name, req.user?.id ?? null);
  },
);

// PUT /api/sub-products/:spId/revisions/:revId/documents/:docId — replace
router.put(
  '/sub-products/:spId/revisions/:revId/documents/:docId',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const spId = parseId(req.params.spId);
    const revId = parseId(req.params.revId);
    const docId = parseId(req.params.docId);
    if (!spId || !revId || !docId) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({
        code: !spId
          ? ErrorCodes.INVALID_SUB_PRODUCT_ID
          : !revId
            ? ErrorCodes.INVALID_REVISION_ID
            : ErrorCodes.INVALID_DOCUMENT_ID,
      });
    }
    if (!req.file) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });
    if (!(await spRevisionBelongsTo(spId, revId))) {
      safeUnlink(req.file.path);
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    const { name } = parseUploadBody(req);
    return handleReplace(res, 'subProduct', revId, docId, req.file, name);
  },
);

// DELETE /api/sub-products/:spId/revisions/:revId/documents/:docId
router.delete(
  '/sub-products/:spId/revisions/:revId/documents/:docId',
  requireAuth,
  async (req, res) => {
    const spId = parseId(req.params.spId);
    const revId = parseId(req.params.revId);
    const docId = parseId(req.params.docId);
    if (!spId) return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
    if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    if (!docId) return res.status(400).json({ code: ErrorCodes.INVALID_DOCUMENT_ID });
    if (!(await spRevisionBelongsTo(spId, revId))) {
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    return handleDelete(res, 'subProduct', revId, docId);
  },
);

export default router;
