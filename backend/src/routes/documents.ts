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
import { pool, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  documentLinkSchema,
  documentUploadSchema,
  type DocumentUploadPayload,
} from '../schemas/documents.schema.js';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
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
import {
  listRevisionStats,
  type RevisionTypeStats,
} from '../services/documentRevisions.js';
import { ensureTmpDir } from '../services/uploadPaths.js';
import { parseId, requireId } from './routeParams.js';

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

/** Marker so the wrapper below can tell a filter rejection from a real fault. */
class UnsupportedFileTypeError extends Error {}

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Gated on EXTENSION, not MIME type — see `ALLOWED_UPLOAD_EXTENSIONS` in
    // services/documentFiles.ts for why, and why it's the single source of
    // truth shared with the document-type schema. A document type's own
    // `allowedExtensions` narrows this further, per card.
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
      return next(new ApiError(400, ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED));
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(413, ErrorCodes.DOCUMENT_TOO_LARGE));
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

/** Status is per plan §2 — a card holding something is `complete`; an empty one
 *  is `missing` when required and `optional` when not.
 *
 *  What counts as "holding something" differs by card kind: a file for an
 *  ordinary one, a production version WITH a file for a versioned one. */
function cardStatus(template: DocumentTypeTemplate, satisfied: boolean) {
  return satisfied ? 'complete' : template.required ? 'missing' : 'optional';
}

/**
 * The panel payload: one entry per document type that applies to this entity
 * (inherited from its type first, then the entity's own — see
 * `listDocumentTypesForRevision`), each carrying its files and status, plus the
 * ad-hoc "Other documents" bucket and a summary.
 *
 * Versioned cards come back separately in `revisionTypes`: they hold versions
 * rather than files, and the panel renders them in a section of their own. Both
 * lists feed the summary.
 */
function groupDocuments(
  scope: DocumentScope,
  templates: DocumentTypeTemplate[],
  rows: DocumentRow[],
  revisionStats: Map<number, RevisionTypeStats>,
) {
  const fileTemplates = templates.filter((template) => !template.revision_mode);
  // A file filed under a card that later became versioned would fall through to
  // "Other" rather than disappear — see the comment on `templateIds` below.
  const templateIds = new Set(fileTemplates.map((template) => template.id));
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

  const documentTypes = fileTemplates.map((template) => {
    const files = filesByType.get(template.id) ?? [];
    return {
      id: template.id,
      name: template.name,
      icon: template.icon,
      allowedExtensions: template.allowed_extensions ?? [],
      required: template.required,
      // Defined on this entity alone, so the panel may edit or delete it in
      // place; an inherited one belongs to the type and to the settings page.
      custom: template.custom,
      revisionMode: false,
      status: cardStatus(template, files.length > 0),
      files: files.map((row) => docResponse(scope, row)),
    };
  });

  const revisionTypes = templates
    .filter((template) => template.revision_mode)
    .map((template) => {
      const stats = revisionStats.get(template.id);
      const versionCount = stats?.versionCount ?? 0;
      return {
        id: template.id,
        name: template.name,
        icon: template.icon,
        allowedExtensions: template.allowed_extensions ?? [],
        required: template.required,
        custom: template.custom,
        revisionMode: true,
        // Deliberately not `versionCount > 0`: versions are created before
        // their files are uploaded, so counting them marked a card complete the
        // moment it had an empty placeholder on it.
        status: cardStatus(template, stats?.productionHasFiles ?? false),
        versionCount,
        productionName: stats?.productionName ?? null,
      };
    });

  const cards = [...documentTypes, ...revisionTypes];
  return {
    documentTypes,
    revisionTypes,
    other: other.map((row) => docResponse(scope, row)),
    summary: {
      totalTypes: cards.length,
      uploaded: cards.filter((card) => card.status === 'complete').length,
      missing: cards.filter((card) => card.status === 'missing').length,
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
 * Every refusal throws; `withUploadCleanup` takes the temp file with it, so
 * nothing accumulates on disk.
 */
async function prepareIncomingFile(
  scope: DocumentScope,
  revisionId: number,
  file: Express.Multer.File,
  body: DocumentUploadPayload,
): Promise<{ storageKey: string; displayName: string }> {
  const entity = await findEntityForRevision(pool, scope, revisionId);
  if (!entity) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);

  if (body.documentTypeId != null) {
    const template = await findDocumentTypeForRevision(
      pool,
      scope,
      revisionId,
      body.documentTypeId,
    );
    // Not just "unknown id" — also a real document type belonging to a
    // different product/sub-product type than this revision's entity, or a
    // versioned card, whose files go through routes/documentRevisions.ts.
    if (!template || template.revision_mode) {
      throw new ApiError(400, ErrorCodes.DOCUMENT_TYPE_MISMATCH);
    }
    // Always the UPLOADED file's name, never `body.name`: the rule is about
    // the bytes, and a custom name is only a label. Checking the label
    // rejected valid uploads (typing "Gerber Files" for a .zip on a
    // .zip-only card) and would let a mislabelled file through the card's
    // gate — `resolveDisplayName` guarantees the stored name ends in this
    // same, already-validated extension.
    if (!extensionAllowed(template, file.originalname)) {
      throw new ApiError(400, ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED);
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
  scope: DocumentScope,
  revisionId: number,
  file: Express.Multer.File,
  body: DocumentUploadPayload,
  userId: number | null,
) {
  const placed = await prepareIncomingFile(scope, revisionId, file, body);

  try {
    return await withTransaction(async (client) => {
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
    return docResponse(scope, row);
    });
  } catch (err) {
    // The file is already on disk and outside `_tmp`, so nothing else would
    // reclaim it.
    unlinkStoredFile(placed.storageKey);
    throw err;
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
  scope: DocumentScope,
  revisionId: number,
  docId: number,
  file: Express.Multer.File,
  body: DocumentUploadPayload,
) {
  const placed = await prepareIncomingFile(scope, revisionId, file, body);

  let replaced;
  try {
    replaced = await withTransaction(async (client) => {
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
    if (!result) throw new ApiError(404, ErrorCodes.DOCUMENT_NOT_FOUND);
    return result;
    });
  } catch (err) {
    unlinkStoredFile(placed.storageKey);
    throw err;
  }

  // Post-commit: an unlink cannot be rolled back, so the file this row used to
  // point at only goes once the new one is durably recorded.
  unlinkStoredFile(replaced.orphanKey);
  return docResponse(scope, replaced.row);
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
  scope: DocumentScope,
  revisionId: number,
  body: { sourceDocumentId: number; documentTypeId?: number | null },
  userId: number | null,
) {
  const documentTypeId = body.documentTypeId ?? null;

  const source = await findLinkSource(pool, scope, revisionId, body.sourceDocumentId);
  if (!source) throw new ApiError(404, ErrorCodes.DOCUMENT_LINK_SOURCE_NOT_FOUND);

  if (documentTypeId != null) {
    // Same rule as upload: the card must belong to this entity's type, and
    // must not be a versioned one.
    const template = await findDocumentTypeForRevision(pool, scope, revisionId, documentTypeId);
    if (!template || template.revision_mode) {
      throw new ApiError(400, ErrorCodes.DOCUMENT_TYPE_MISMATCH);
    }

    // The target card's extension rule applies to a borrowed file too.
    if (!extensionAllowed(template, source.original_name)) {
      throw new ApiError(400, ErrorCodes.DOCUMENT_EXTENSION_NOT_ALLOWED);
    }
  }

  if (await isStoredFileLinked(pool, scope, revisionId, source.stored_file_id, documentTypeId)) {
    throw new ApiError(409, ErrorCodes.DOCUMENT_ALREADY_LINKED);
  }

  // Single INSERT: no second write to keep in step, no file to roll back.
  const row = await insertDocument(pool, scope, {
    revisionId,
    storedFileId: source.stored_file_id,
    originalName: source.original_name,
    documentTypeId,
    uploadedBy: userId,
  });
  return docResponse(scope, row);
}

/** Delete one revision's document row, unlinking the file only if unshared. */
async function handleDelete(scope: DocumentScope, revisionId: number, docId: number) {
  const orphanKey = await withTransaction(async (client) => {
    const deleted = await deleteDocument(client, scope, revisionId, docId);
    if (!deleted.found) throw new ApiError(404, ErrorCodes.DOCUMENT_NOT_FOUND);
    return deleted.orphanKey;
  });

  // Post-commit: an unlink cannot be rolled back.
  unlinkStoredFile(orphanKey);
}

// ── Parameter parsing ──────────────────────────────────────────────────────

/**
 * Multer has already written the upload by the time a handler runs, so every
 * exit that is not a success has to take it with it — a bad id, a rejected
 * body, an unknown card, a failed insert. Wrapping the handler once means each
 * of those can simply throw.
 */
function withUploadCleanup(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (req.file) safeUnlink(req.file.path);
      throw err;
    }
  };
}

/** The uploaded file, or the 400 its absence means. */
function requireUploadedFile(req: Request): Express.Multer.File {
  if (!req.file) throw new ApiError(400, ErrorCodes.NO_FILE_UPLOADED);
  return req.file;
}

/**
 * The sub-product revision a URL names, proven to belong to the sub-product it
 * names too — without the check, `/sub-products/9/revisions/4/...` would read
 * and write sub-product 3's revision 4. Six routes need exactly this.
 */
async function requireSubProductRevision(req: Request): Promise<number> {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_SUB_PRODUCT_ID);
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  if (!(await spRevisionBelongsTo(spId, revId))) {
    throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);
  }
  return revId;
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
  // Versions belong to the entity rather than to this revision, so they are
  // summarised per card instead of being loaded here (see documentRevisions.ts).
  const revisionStats = await listRevisionStats(
    pool,
    scope,
    templates.filter((template) => template.revision_mode).map((template) => template.id),
  );
  return groupDocuments(scope, templates, rows, revisionStats);
}

/**
 * Stream a document as a download. `Content-Disposition: attachment` with the
 * row's display name, so the browser saves it under a meaningful name rather
 * than opening it or using the on-disk storage key.
 */
async function handleDownload(res: Response, scope: DocumentScope, docId: number) {
  const row = await findDocument(pool, scope, docId);
  if (!row) throw new ApiError(404, ErrorCodes.DOCUMENT_NOT_FOUND);

  const absolute = resolveStoredFilePath(row.storage_key);
  if (!absolute || !fs.existsSync(absolute)) {
    throw new ApiError(404, ErrorCodes.DOCUMENT_FILE_MISSING);
  }
  if (row.mime_type) res.type(row.mime_type);
  return res.download(absolute, row.original_name);
}

// ── Product revision documents ─────────────────────────────────────────────

// GET /api/product-revisions/:revId/documents — grouped panel payload
router.get('/product-revisions/:revId/documents', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  res.json(await loadPanel('product', revId));
});

// GET /api/product-revisions/:revId/documents/linkable?documentTypeId=
router.get('/product-revisions/:revId/documents/linkable', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const documentTypeId = parseId(req.query.documentTypeId);
  const rows = await listLinkableDocuments(pool, 'product', revId, documentTypeId);
  res.json(groupLinkable('product', rows));
});

// POST /api/product-revisions/:revId/documents/link
router.post('/product-revisions/:revId/documents/link', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const body = documentLinkSchema.parse(req.body ?? {});
  res.status(201).json(await handleLink('product', revId, body, req.user?.id ?? null));
});

// GET /api/product-revision-documents/:docId/download
router.get('/product-revision-documents/:docId/download', requireAuth, async (req, res) => {
  const docId = requireId(req.params.docId, ErrorCodes.INVALID_DOCUMENT_ID);
  return handleDownload(res, 'product', docId);
});

// POST /api/product-revisions/:revId/documents — multipart upload
router.post(
  '/product-revisions/:revId/documents',
  requireAuth,
  uploadSingle,
  withUploadCleanup(async (req, res) => {
    const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
    const file = requireUploadedFile(req);
    const body = documentUploadSchema.parse(req.body ?? {});
    const doc = await handleUpload('product', revId, file, body, req.user?.id ?? null);
    res.status(201).json(doc);
  }),
);

// PUT /api/product-revisions/:revId/documents/:docId — replace (copy-on-write)
router.put(
  '/product-revisions/:revId/documents/:docId',
  requireAuth,
  uploadSingle,
  withUploadCleanup(async (req, res) => {
    const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
    const docId = requireId(req.params.docId, ErrorCodes.INVALID_DOCUMENT_ID);
    const file = requireUploadedFile(req);
    const body = documentUploadSchema.parse(req.body ?? {});
    res.json(await handleReplace('product', revId, docId, file, body));
  }),
);

// DELETE /api/product-revisions/:revId/documents/:docId
router.delete('/product-revisions/:revId/documents/:docId', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const docId = requireId(req.params.docId, ErrorCodes.INVALID_DOCUMENT_ID);
  await handleDelete('product', revId, docId);
  res.status(204).end();
});

// ── Sub-product revision documents ─────────────────────────────────────────

// GET /api/sub-products/:spId/revisions/:revId/documents — grouped payload
router.get(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  async (req, res) => {
    const revId = await requireSubProductRevision(req);
    res.json(await loadPanel('subProduct', revId));
  },
);

// GET /api/sub-products/:spId/revisions/:revId/documents/linkable
router.get(
  '/sub-products/:spId/revisions/:revId/documents/linkable',
  requireAuth,
  async (req, res) => {
    const revId = await requireSubProductRevision(req);
    const documentTypeId = parseId(req.query.documentTypeId);
    const rows = await listLinkableDocuments(pool, 'subProduct', revId, documentTypeId);
    res.json(groupLinkable('subProduct', rows));
  },
);

// POST /api/sub-products/:spId/revisions/:revId/documents/link
router.post(
  '/sub-products/:spId/revisions/:revId/documents/link',
  requireAuth,
  async (req, res) => {
    const revId = await requireSubProductRevision(req);
    const body = documentLinkSchema.parse(req.body ?? {});
    res.status(201).json(await handleLink('subProduct', revId, body, req.user?.id ?? null));
  },
);

// GET /api/sub-product-revision-documents/:docId/download
router.get('/sub-product-revision-documents/:docId/download', requireAuth, async (req, res) => {
  const docId = requireId(req.params.docId, ErrorCodes.INVALID_DOCUMENT_ID);
  return handleDownload(res, 'subProduct', docId);
});

// POST /api/sub-products/:spId/revisions/:revId/documents
router.post(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  uploadSingle,
  withUploadCleanup(async (req, res) => {
    const revId = await requireSubProductRevision(req);
    const file = requireUploadedFile(req);
    const body = documentUploadSchema.parse(req.body ?? {});
    const doc = await handleUpload('subProduct', revId, file, body, req.user?.id ?? null);
    res.status(201).json(doc);
  }),
);

// PUT /api/sub-products/:spId/revisions/:revId/documents/:docId — replace
router.put(
  '/sub-products/:spId/revisions/:revId/documents/:docId',
  requireAuth,
  uploadSingle,
  withUploadCleanup(async (req, res) => {
    const revId = await requireSubProductRevision(req);
    const docId = requireId(req.params.docId, ErrorCodes.INVALID_DOCUMENT_ID);
    const file = requireUploadedFile(req);
    const body = documentUploadSchema.parse(req.body ?? {});
    res.json(await handleReplace('subProduct', revId, docId, file, body));
  }),
);

// DELETE /api/sub-products/:spId/revisions/:revId/documents/:docId
router.delete(
  '/sub-products/:spId/revisions/:revId/documents/:docId',
  requireAuth,
  async (req, res) => {
    const revId = await requireSubProductRevision(req);
    const docId = requireId(req.params.docId, ErrorCodes.INVALID_DOCUMENT_ID);
    await handleDelete('subProduct', revId, docId);
    res.status(204).end();
  },
);

export default router;
