import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';

const router = Router();

// ── Storage ────────────────────────────────────────────────────────────────

const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Files first land in the base documents folder under a temporary name, then
// the request handler moves them into their per-entity subfolder once the
// SKU (and any custom name) is known.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

// ── Filesystem helpers ───────────────────────────────────────────────────────

// Make a string safe to use as a single path segment (folder or file name):
// strip path separators / control chars and guard against traversal.
function sanitizeSegment(input: string): string {
  const cleaned = input
    .replace(/[/\\]/g, '_') // path separators
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '') // control chars
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return '_';
  return cleaned;
}

// Build the "{name}-{sku}" style folder name. Spaces in the name are turned
// into dashes so the folder is a single tidy token.
function folderName(prefix: string, name: string, sku: string): string {
  const dashedName = name.replace(/\s+/g, '-');
  return sanitizeSegment(`${prefix}${dashedName}-${sku}`);
}

// Resolve the final on-disk file name inside `dirAbs`, based on a desired base
// name (custom or original). Preserves the original extension and appends
// " (n)" if a file with that name already exists so nothing is overwritten.
function resolveUniqueName(
  dirAbs: string,
  desiredName: string,
  originalName: string,
): string {
  const originalExt = path.extname(originalName);
  let base = sanitizeSegment(desiredName || originalName);

  // Ensure the desired name keeps a sensible extension.
  if (path.extname(base) === '' && originalExt) base += originalExt;

  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length) || base;

  let candidate = base;
  let counter = 1;
  while (fs.existsSync(path.join(dirAbs, candidate))) {
    candidate = `${stem} (${counter})${ext}`;
    counter += 1;
  }
  return candidate;
}

// Move the uploaded temp file into `folder`, naming it from the custom name (if
// provided) or the original name. Returns { filename, path, displayName } where
// `filename` is relative to the documents dir (folder/name).
function placeUpload(
  file: Express.Multer.File,
  folder: string,
  customName: string | undefined,
): { filename: string; path: string; displayName: string } {
  const dirAbs = path.join(uploadDir, folder);
  if (!fs.existsSync(dirAbs)) fs.mkdirSync(dirAbs, { recursive: true });

  const desired = (customName ?? '').trim();
  const finalName = resolveUniqueName(dirAbs, desired, file.originalname);

  fs.renameSync(file.path, path.join(dirAbs, finalName));

  const relative = `${folder}/${finalName}`;
  // filename stays raw (used for filesystem access on delete); the public path
  // is URL-encoded per segment so spaces/parentheses resolve correctly.
  const urlPath = `/uploads/documents/${encodeURIComponent(folder)}/${encodeURIComponent(finalName)}`;
  return {
    filename: relative,
    path: urlPath,
    displayName: finalName,
  };
}

function safeUnlink(absPath: string): void {
  if (fs.existsSync(absPath)) {
    try { fs.unlinkSync(absPath); } catch { /* ignore */ }
  }
}

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

// ── Helper ─────────────────────────────────────────────────────────────────

function docRow(row: any) {
  return {
    id: row.id,
    originalName: row.original_name,
    filename: row.filename,
    mimeType: row.mime_type,
    path: row.path,
    createdAt: row.created_at,
  };
}

// ── Product documents ──────────────────────────────────────────────────────

// GET /api/products/:productId/documents
router.get('/products/:productId/documents', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const result = await query(
    `SELECT id, original_name, filename, mime_type, path, created_at
     FROM product_documents
     WHERE product_id = $1
     ORDER BY created_at DESC`,
    [productId],
  );
  res.json(result.rows.map(docRow));
});

// POST /api/products/:productId/documents — multipart upload
router.post(
  '/products/:productId/documents',
  requireAuth,
  upload.single('file'),
  async (req: any, res) => {
    const productId = Number(req.params.productId);
    if (!productId || Number.isNaN(productId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
    }
    if (!req.file) {
      return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });
    }

    // Resolve the product name + SKU for the destination folder "{name}-{sku}".
    const product = await query(`SELECT name, sku FROM products WHERE id = $1`, [productId]);
    if (product.rowCount === 0) {
      safeUnlink(req.file.path);
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }

    const folder = folderName('', product.rows[0].name, product.rows[0].sku);
    const placed = placeUpload(req.file, folder, req.body?.name);

    const result = await query(
      `INSERT INTO product_documents
         (product_id, original_name, filename, mime_type, path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, original_name, filename, mime_type, path, created_at`,
      [
        productId,
        placed.displayName,
        placed.filename,
        req.file.mimetype,
        placed.path,
        req.user?.id ?? null,
      ],
    );
    res.status(201).json(docRow(result.rows[0]));
  },
);

// DELETE /api/products/:productId/documents/:docId
router.delete(
  '/products/:productId/documents/:docId',
  requireAuth,
  async (req, res) => {
    const productId = Number(req.params.productId);
    const docId = Number(req.params.docId);
    if (!productId || !docId) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
    }

    const existing = await query(
      `SELECT filename FROM product_documents WHERE id = $1 AND product_id = $2`,
      [docId, productId],
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_NOT_FOUND });
    }

    // Delete file from disk
    const filePath = path.join(uploadDir, existing.rows[0].filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }

    await query(`DELETE FROM product_documents WHERE id = $1`, [docId]);
    res.status(204).end();
  },
);

// ── Sub-product revision documents ─────────────────────────────────────────

// GET /api/sub-products/:spId/revisions/:revId/documents
router.get(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  async (req, res) => {
    const revId = Number(req.params.revId);
    if (!revId || Number.isNaN(revId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    }
    const result = await query(
      `SELECT id, original_name, filename, mime_type, path, created_at
       FROM sub_product_revision_documents
       WHERE sub_product_revision_id = $1
       ORDER BY created_at DESC`,
      [revId],
    );
    res.json(result.rows.map(docRow));
  },
);

// POST /api/sub-products/:spId/revisions/:revId/documents
router.post(
  '/sub-products/:spId/revisions/:revId/documents',
  requireAuth,
  upload.single('file'),
  async (req: any, res) => {
    const spId = Number(req.params.spId);
    const revId = Number(req.params.revId);
    if (!revId || Number.isNaN(revId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    }
    if (!spId || Number.isNaN(spId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
    }
    if (!req.file) {
      return res.status(400).json({ code: ErrorCodes.NO_FILE_UPLOADED });
    }

    // Resolve the sub-product name + SKU for the folder "sub-{name}-{sku}".
    const subProduct = await query(`SELECT name, sku FROM sub_products WHERE id = $1`, [spId]);
    if (subProduct.rowCount === 0) {
      safeUnlink(req.file.path);
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_NOT_FOUND });
    }

    const folder = folderName('sub-', subProduct.rows[0].name, subProduct.rows[0].sku);
    const placed = placeUpload(req.file, folder, req.body?.name);

    const result = await query(
      `INSERT INTO sub_product_revision_documents
         (sub_product_revision_id, original_name, filename, mime_type, path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, original_name, filename, mime_type, path, created_at`,
      [
        revId,
        placed.displayName,
        placed.filename,
        req.file.mimetype,
        placed.path,
        req.user?.id ?? null,
      ],
    );
    res.status(201).json(docRow(result.rows[0]));
  },
);

// DELETE /api/sub-products/:spId/revisions/:revId/documents/:docId
router.delete(
  '/sub-products/:spId/revisions/:revId/documents/:docId',
  requireAuth,
  async (req, res) => {
    const revId = Number(req.params.revId);
    const docId = Number(req.params.docId);
    if (!revId || !docId) {
      return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
    }

    const existing = await query(
      `SELECT filename FROM sub_product_revision_documents
       WHERE id = $1 AND sub_product_revision_id = $2`,
      [docId, revId],
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.DOCUMENT_NOT_FOUND });
    }

    const filePath = path.join(uploadDir, existing.rows[0].filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }

    await query(`DELETE FROM sub_product_revision_documents WHERE id = $1`, [docId]);
    res.status(204).end();
  },
);

export default router;
