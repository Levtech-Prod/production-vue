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
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  documentLinkSchema,
  documentUploadSchema,
  type DocumentUploadPayload,
} from '../schemas/documents.schema.js';
import {
  deleteDocument,
  resolveEntityDocumentsDir,
  fileExtension,
  findDocument,
  findDocumentTypeForRevision,
  findEntityForRevision,
  findLinkSource,
  insertDocument,
  insertStoredFile,
  isStoredFileLinked,
  listDocuments,
  listDocumentTypesForRevision,
  listLinkableDocuments,
  placeUpload,
  publicPath,
  repointDocument,
  resolveStoredFilePath,
  safeUnlink,
  unlinkStoredFile,
  type DocumentRow,
  type DocumentScope,
  type DocumentTypeTemplate,
  type LinkableDocumentRow,
} from '../services/documentFiles.js';
import { ensureTmpDir } from '../services/uploadPaths.js';

const router = Router();

// ── Upload handling ────────────────────────────────────────────────────────

// Files land in `_tmp` under a temporary name; the handler moves them into the
// owning entity's folder once it is resolved. Kept out of `products/` so a
// half-written file can never be mistaken for a real document by the migration
// or the resync script.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureTmpDir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

// The gate is the file EXTENSION, not the MIME type (plan §7.4): engineering
// formats mostly have no registered MIME, so browsers send them as
// application/octet-stream and a MIME allow-list would either reject every
// .step file or have to admit octet-stream and stop meaning anything. A
// document type's own `allowedExtensions` narrows this further, per card.
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  // Documents and data
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.json', '.xml', '.log',
  // Images (no .svg — it is scriptable and we serve uploads statically)
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  // Archives
  '.zip', '.rar', '.7z', '.gz', '.tar',
  // Mechanical CAD / CAM
  '.step', '.stp', '.iges', '.igs', '.stl', '.dxf', '.dwg',
  '.sldprt', '.sldasm', '.ipt', '.iam', '.f3d', '.3mf', '.obj',
  '.nc', '.tap', '.gcode', '.cnc',
  // Electronics CAD / fabrication
  '.gbr', '.gbl', '.gtl', '.gbs', '.gts', '.gbo', '.gto', '.gko',
  '.drl', '.xln', '.gerber',
  '.pcbdoc', '.schdoc', '.prjpcb', '.sch', '.brd', '.kicad_pcb', '.kicad_sch',
  // Firmware
  '.hex', '.elf', '.bin', '.map', '.s19', '.srec', '.uf2', '.dfu',
]);

/** Marker so the wrapper below can tell a filter rejection from a real fault. */
class UnsupportedFileTypeError extends Error {}

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(fileExtension(file.originalname))) {
      return cb(new UnsupportedFileTypeError(file.originalname));
    }
    cb(null, true);
  },
});

/**
 * `upload.single('file')` with its rejections translated into API error codes.
 * Multer surfaces both the extension filter and the size limit as thrown
 * errors, which would otherwise reach the global handler as a generic
 * REQUEST_FAILED and leave the UI with nothing specific to say.
 */
function uploadSingle(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof UnsupportedFileTypeError) {
      return res.status(400).json({ code: ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED });
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ code: ErrorCodes.DOCUMENT_TOO_LARGE });
    }
    return next(err);
  });
}

// ── Response shape ─────────────────────────────────────────────────────────

/** Where the forced-download endpoint for a document lives. */
function downloadUrl(scope: DocumentScope, docId: number): string {
  const base = scope === 'product' ? 'product-revision-documents' : 'sub-product-revision-documents';
  return `/api/${base}/${docId}/download`;
}

function docResponse(scope: DocumentScope, row: DocumentRow) {
  return {
    id: row.id,
    documentTypeId: row.document_type_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    // Two ways to reach the file, because the card offers both: `path` is the
    // statically served URL for opening it in a tab, `downloadUrl` hits the
    // endpoint that forces a save under the original name.
    path: publicPath(row.storage_key),
    downloadUrl: downloadUrl(scope, row.id),
    createdAt: row.created_at,
  };
}

/**
 * The panel payload: one entry per document type defined for this entity's
 * type (in `sort_order`), each carrying its files and status, plus the ad-hoc
 * "Other documents" bucket and a summary. Status is per plan §2 — a type with
 * at least one file is `complete`; with none it is `missing` when required and
 * `optional` when not.
 */
function groupDocuments(
  scope: DocumentScope,
  templates: DocumentTypeTemplate[],
  rows: DocumentRow[],
) {
  const templateIds = new Set(templates.map((template) => template.id));
  const filesByType = new Map<number, DocumentRow[]>();
  const other: DocumentRow[] = [];
  for (const row of rows) {
    // A type id with no matching template falls through to "Other" rather than
    // being dropped: a row can outlive its card (e.g. the entity's `type` stops
    // matching a `product_types.name`), and a stored file must never be
    // invisible in the panel.
    if (row.document_type_id == null || !templateIds.has(row.document_type_id)) {
      other.push(row);
      continue;
    }
    const list = filesByType.get(row.document_type_id) ?? [];
    list.push(row);
    filesByType.set(row.document_type_id, list);
  }

  const documentTypes = templates.map((template) => {
    const files = filesByType.get(template.id) ?? [];
    const status = files.length > 0 ? 'complete' : template.required ? 'missing' : 'optional';
    return {
      id: template.id,
      name: template.name,
      icon: template.icon,
      allowedExtensions: template.allowed_extensions ?? [],
      required: template.required,
      status,
      files: files.map((row) => docResponse(scope, row)),
    };
  });

  return {
    documentTypes,
    other: other.map((row) => docResponse(scope, row)),
    summary: {
      totalTypes: documentTypes.length,
      uploaded: documentTypes.filter((t) => t.status === 'complete').length,
      missing: documentTypes.filter((t) => t.status === 'missing').length,
    },
  };
}

/**
 * Reject a file the target card doesn't accept. An empty `allowedExtensions`
 * means the card takes anything (the global list above still applies).
 */
function extensionAllowed(template: DocumentTypeTemplate, fileName: string): boolean {
  const allowed = template.allowed_extensions ?? [];
  return allowed.length === 0 || allowed.includes(fileExtension(fileName));
}

// ── Shared handlers ────────────────────────────────────────────────────────

/**
 * Shared preamble for upload and replace: resolve the owning entity, check the
 * target card if one was named, and move the file into the entity's folder.
 * Returns an error code instead when the request can't proceed — the temp file
 * is removed on every rejection path so nothing accumulates on disk.
 */
async function prepareIncomingFile(
  scope: DocumentScope,
  revisionId: number,
  file: Express.Multer.File,
  body: DocumentUploadPayload,
): Promise<{ storageKey: string; displayName: string } | { error: string }> {
  const entity = await findEntityForRevision(pool, scope, revisionId);
  if (!entity) {
    safeUnlink(file.path);
    return { error: ErrorCodes.REVISION_NOT_FOUND };
  }

  if (body.documentTypeId != null) {
    const template = await findDocumentTypeForRevision(
      pool,
      scope,
      revisionId,
      body.documentTypeId,
    );
    // Not just "unknown id" — also a real document type belonging to a
    // different product/sub-product type than this revision's entity.
    if (!template) {
      safeUnlink(file.path);
      return { error: ErrorCodes.DOCUMENT_TYPE_MISMATCH };
    }
    // Always the UPLOADED file's name, never `body.name`: the rule is about
    // the bytes, and a custom name is only a label. Checking the label
    // rejected valid uploads (typing "Gerber Files" for a .zip on a
    // .zip-only card) and would let a mislabelled file through the card's
    // gate — `resolveDisplayName` guarantees the stored name ends in this
    // same, already-validated extension.
    if (!extensionAllowed(template, file.originalname)) {
      safeUnlink(file.path);
      return { error: ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED };
    }
  }

  return placeUpload(file, resolveEntityDocumentsDir(entity), body.name);
}

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
  body: DocumentUploadPayload,
  userId: number | null,
) {
  const placed = await prepareIncomingFile(scope, revisionId, file, body);
  if ('error' in placed) {
    const status = placed.error === ErrorCodes.REVISION_NOT_FOUND ? 404 : 400;
    return res.status(status).json({ code: placed.error });
  }

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
      documentTypeId: body.documentTypeId,
      uploadedBy: userId,
    });
    await client.query('COMMIT');
    res.status(201).json(docResponse(scope, row));
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
  body: DocumentUploadPayload,
) {
  const placed = await prepareIncomingFile(scope, revisionId, file, body);
  if ('error' in placed) {
    const status = placed.error === ErrorCodes.REVISION_NOT_FOUND ? 404 : 400;
    return res.status(status).json({ code: placed.error });
  }

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
    res.json(docResponse(scope, result.row));
  } catch (err) {
    await client.query('ROLLBACK');
    unlinkStoredFile(placed.storageKey);
    throw err;
  } finally {
    client.release();
  }
}

/** The picker payload, grouped by the revision each file sits on. */
function groupLinkable(scope: DocumentScope, rows: LinkableDocumentRow[]) {
  const revisions: {
    revisionId: number;
    revisionLabel: string;
    revisionNumber: number;
    files: (ReturnType<typeof docResponse> & { alreadyLinked: boolean })[];
  }[] = [];

  // The query orders by revision, so a running group beats a map plus re-sort.
  for (const row of rows) {
    let group = revisions[revisions.length - 1];
    if (!group || group.revisionId !== row.revision_id) {
      group = {
        revisionId: row.revision_id,
        revisionLabel: row.revision_label,
        revisionNumber: row.revision_number,
        files: [],
      };
      revisions.push(group);
    }
    group.files.push({ ...docResponse(scope, row), alreadyLinked: row.already_linked });
  }

  return { revisions };
}

/** Link a file a sibling revision holds: a document row over the same
 *  `stored_file_id`. Nothing is written to disk. */
async function handleLink(
  res: Response,
  scope: DocumentScope,
  revisionId: number,
  body: { sourceDocumentId: number; documentTypeId?: number | null },
  userId: number | null,
) {
  const documentTypeId = body.documentTypeId ?? null;

  const source = await findLinkSource(pool, scope, revisionId, body.sourceDocumentId);
  if (!source) {
    return res.status(404).json({ code: ErrorCodes.DOCUMENT_LINK_SOURCE_NOT_FOUND });
  }

  if (documentTypeId != null) {
    // Same rule as upload: the card must belong to this entity's type.
    const template = await findDocumentTypeForRevision(pool, scope, revisionId, documentTypeId);
    if (!template) return res.status(400).json({ code: ErrorCodes.DOCUMENT_TYPE_MISMATCH });

    // The target card's extension rule applies to a borrowed file too.
    if (!extensionAllowed(template, source.original_name)) {
      return res.status(400).json({ code: ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED });
    }
  }

  if (await isStoredFileLinked(pool, scope, revisionId, source.stored_file_id, documentTypeId)) {
    return res.status(409).json({ code: ErrorCodes.DOCUMENT_ALREADY_LINKED });
  }

  // Single INSERT: no second write to keep in step, no file to roll back.
  const row = await insertDocument(pool, scope, {
    revisionId,
    storedFileId: source.stored_file_id,
    originalName: source.original_name,
    documentTypeId,
    uploadedBy: userId,
  });
  return res.status(201).json(docResponse(scope, row));
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

/** The grouped panel payload for one revision. */
async function loadPanel(scope: DocumentScope, revisionId: number) {
  const [templates, rows] = await Promise.all([
    listDocumentTypesForRevision(pool, scope, revisionId),
    listDocuments(pool, scope, revisionId),
  ]);
  return groupDocuments(scope, templates, rows);
}

/**
 * Stream a document as a download. `Content-Disposition: attachment` with the
 * row's display name, so the browser saves it under a meaningful name rather
 * than opening it or using the on-disk storage key.
 */
async function handleDownload(res: Response, scope: DocumentScope, docId: number) {
  const row = await findDocument(pool, scope, docId);
  if (!row) return res.status(404).json({ code: ErrorCodes.DOCUMENT_NOT_FOUND });

  const absolute = resolveStoredFilePath(row.storage_key);
  if (!absolute || !fs.existsSync(absolute)) {
    return res.status(404).json({ code: ErrorCodes.DOCUMENT_FILE_MISSING });
  }
  if (row.mime_type) res.type(row.mime_type);
  return res.download(absolute, row.original_name);
}

// ── Product revision documents ─────────────────────────────────────────────

// GET /api/product-revisions/:revId/documents — grouped panel payload
router.get('/product-revisions/:revId/documents', requireAuth, async (req, res) => {
  const revId = parseId(req.params.revId);
  if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });

  res.json(await loadPanel('product', revId));
});

// GET /api/product-revisions/:revId/documents/linkable?documentTypeId=
router.get('/product-revisions/:revId/documents/linkable', requireAuth, async (req, res) => {
  const revId = parseId(req.params.revId);
  if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });

  const documentTypeId = parseId(req.query.documentTypeId as string | undefined);
  const rows = await listLinkableDocuments(pool, 'product', revId, documentTypeId);
  res.json(groupLinkable('product', rows));
});

// POST /api/product-revisions/:revId/documents/link
router.post('/product-revisions/:revId/documents/link', requireAuth, async (req, res) => {
  const revId = parseId(req.params.revId);
  if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });

  const body = documentLinkSchema.parse(req.body ?? {});
  return handleLink(res, 'product', revId, body, req.user?.id ?? null);
});

// GET /api/product-revision-documents/:docId/download
router.get('/product-revision-documents/:docId/download', requireAuth, async (req, res) => {
  const docId = parseId(req.params.docId);
  if (!docId) return res.status(400).json({ code: ErrorCodes.INVALID_DOCUMENT_ID });

  return handleDownload(res, 'product', docId);
});

// POST /api/product-revisions/:revId/documents — multipart upload
router.post(
  '/product-revisions/:revId/documents',
  requireAuth,
  uploadSingle,
  async (req, res) => {
    const revId = parseId(req.params.revId);
    if (!revId) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    }
    if (!req.file) return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });

    const body = parseUploadBody(req);
    return handleUpload(res, 'product', revId, req.file, body, req.user?.id ?? null);
  },
);

// PUT /api/product-revisions/:revId/documents/:docId — replace (copy-on-write)
router.put(
  '/product-revisions/:revId/documents/:docId',
  requireAuth,
  uploadSingle,
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

    const body = parseUploadBody(req);
    return handleReplace(res, 'product', revId, docId, req.file, body);
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

// GET /api/sub-products/:spId/revisions/:revId/documents — grouped payload
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

    res.json(await loadPanel('subProduct', revId));
  },
);

// GET /api/sub-products/:spId/revisions/:revId/documents/linkable
router.get(
  '/sub-products/:spId/revisions/:revId/documents/linkable',
  requireAuth,
  async (req, res) => {
    const spId = parseId(req.params.spId);
    const revId = parseId(req.params.revId);
    if (!spId) return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
    if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    if (!(await spRevisionBelongsTo(spId, revId))) {
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    const documentTypeId = parseId(req.query.documentTypeId as string | undefined);
    const rows = await listLinkableDocuments(pool, 'subProduct', revId, documentTypeId);
    res.json(groupLinkable('subProduct', rows));
  },
);

// POST /api/sub-products/:spId/revisions/:revId/documents/link
router.post(
  '/sub-products/:spId/revisions/:revId/documents/link',
  requireAuth,
  async (req, res) => {
    const spId = parseId(req.params.spId);
    const revId = parseId(req.params.revId);
    if (!spId) return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
    if (!revId) return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    if (!(await spRevisionBelongsTo(spId, revId))) {
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    const body = documentLinkSchema.parse(req.body ?? {});
    return handleLink(res, 'subProduct', revId, body, req.user?.id ?? null);
  },
);

// GET /api/sub-product-revision-documents/:docId/download
router.get('/sub-product-revision-documents/:docId/download', requireAuth, async (req, res) => {
  const docId = parseId(req.params.docId);
  if (!docId) return res.status(400).json({ code: ErrorCodes.INVALID_DOCUMENT_ID });

  return handleDownload(res, 'subProduct', docId);
});

// POST /api/sub-products/:spId/revisions/:revId/documents
router.post(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  uploadSingle,
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

    const body = parseUploadBody(req);
    return handleUpload(res, 'subProduct', revId, req.file, body, req.user?.id ?? null);
  },
);

// PUT /api/sub-products/:spId/revisions/:revId/documents/:docId — replace
router.put(
  '/sub-products/:spId/revisions/:revId/documents/:docId',
  requireAuth,
  uploadSingle,
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

    const body = parseUploadBody(req);
    return handleReplace(res, 'subProduct', revId, docId, req.file, body);
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
