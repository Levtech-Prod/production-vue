// Template management API (document-system-plan.md, Story 3): CRUD + reorder
// for the per-type document requirement lists that the Documents panel
// (Story 5/6) renders as cards. Mirrors the two-sections-in-one-file layout
// of documents.ts — product and sub-product document types are structurally
// identical, just pointed at different tables.
import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  documentTypePayloadSchema,
  documentTypeReorderSchema,
} from '../schemas/documentTypes.schema.js';

const router = Router();

function documentTypeRow(row: any) {
  return {
    id: row.id,
    typeId: row.type_id,
    name: row.name,
    icon: row.icon,
    allowedExtensions: row.allowed_extensions ?? [],
    required: row.required,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// ── Product document types ──────────────────────────────────────────────────

// GET /api/product-types/:typeId/document-types
router.get('/product-types/:typeId/document-types', requireAuth, async (req, res) => {
  const typeId = Number(req.params.typeId);
  if (!typeId || Number.isNaN(typeId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
  }
  const result = await query(
    `SELECT id, product_type_id AS type_id, name, icon, allowed_extensions,
       required, sort_order, created_at
     FROM product_document_types
     WHERE product_type_id = $1
     ORDER BY sort_order ASC, name ASC`,
    [typeId],
  );
  res.json(result.rows.map(documentTypeRow));
});

// POST /api/product-types/:typeId/document-types
router.post(
  '/product-types/:typeId/document-types',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
    }
    const data = documentTypePayloadSchema.parse(req.body);

    const typeExists = await query(`SELECT 1 FROM product_types WHERE id = $1`, [typeId]);
    if (typeExists.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_TYPE_NOT_FOUND });
    }

    try {
      const result = await query(
        `INSERT INTO product_document_types
           (product_type_id, name, icon, allowed_extensions, required, sort_order)
         VALUES (
           $1, $2, $3, $4::text[], $5,
           COALESCE((SELECT MAX(sort_order) + 1 FROM product_document_types WHERE product_type_id = $1), 0)
         )
         RETURNING id, product_type_id AS type_id, name, icon, allowed_extensions,
           required, sort_order, created_at`,
        [typeId, data.name, data.icon, data.allowedExtensions, data.required],
      );
      res.status(201).json(documentTypeRow(result.rows[0]));
    } catch (err: any) {
      if (err?.code === '23505') {
        return res.status(409).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS });
      }
      throw err;
    }
  },
);

// PUT /api/product-types/:typeId/document-types/reorder — full ordered id list
// for that type; array position becomes sort_order. Placed before the plain
// "/:id" routes below so "reorder" is never captured as a document-type id.
router.put(
  '/product-types/:typeId/document-types/reorder',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
    }
    const data = documentTypeReorderSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM product_document_types WHERE product_type_id = $1`,
        [typeId],
      );
      const existingIds = new Set(existing.rows.map((r) => r.id));
      const incomingIds = new Set(data.orderedIds);
      const sameSet =
        existingIds.size === incomingIds.size &&
        [...existingIds].every((id) => incomingIds.has(id));

      if (!sameSet) {
        await client.query('ROLLBACK');
        return res.status(400).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_REORDER_MISMATCH });
      }

      for (let sortOrder = 0; sortOrder < data.orderedIds.length; sortOrder++) {
        await client.query(
          `UPDATE product_document_types SET sort_order = $1
           WHERE id = $2 AND product_type_id = $3`,
          [sortOrder, data.orderedIds[sortOrder], typeId],
        );
      }

      const result = await client.query(
        `SELECT id, product_type_id AS type_id, name, icon, allowed_extensions,
           required, sort_order, created_at
         FROM product_document_types
         WHERE product_type_id = $1
         ORDER BY sort_order ASC, name ASC`,
        [typeId],
      );

      await client.query('COMMIT');
      res.json(result.rows.map(documentTypeRow));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

// PUT /api/product-document-types/:id
router.put('/product-document-types/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_DOCUMENT_TYPE_ID });
  }
  const data = documentTypePayloadSchema.parse(req.body);
  try {
    // sort_order is intentionally left untouched here — only the reorder
    // endpoint above changes ordering.
    const result = await query(
      `UPDATE product_document_types
       SET name = $1, icon = $2, allowed_extensions = $3::text[], required = $4
       WHERE id = $5
       RETURNING id, product_type_id AS type_id, name, icon, allowed_extensions,
         required, sort_order, created_at`,
      [data.name, data.icon, data.allowedExtensions, data.required, id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_NOT_FOUND });
    }
    res.json(documentTypeRow(result.rows[0]));
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS });
    }
    throw err;
  }
});

// DELETE /api/product-document-types/:id — never destroys files: the FK's
// ON DELETE SET NULL demotes any referencing product_revision_documents rows
// to the "Other documents" bucket. The affected-file count lets the UI warn
// before the admin confirms (plan §7 risk 3 / Story 4 AC).
router.delete('/product-document-types/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_DOCUMENT_TYPE_ID });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const affected = await client.query(
      `SELECT COUNT(*)::int AS count FROM product_revision_documents WHERE document_type_id = $1`,
      [id],
    );

    const result = await client.query(
      `DELETE FROM product_document_types WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_DOCUMENT_TYPE_NOT_FOUND });
    }

    await client.query('COMMIT');
    res.json({ id, deleted: true, filesMovedToOther: affected.rows[0].count });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ── Sub-product document types ──────────────────────────────────────────────

// GET /api/sub-product-types/:typeId/document-types
router.get('/sub-product-types/:typeId/document-types', requireAuth, async (req, res) => {
  const typeId = Number(req.params.typeId);
  if (!typeId || Number.isNaN(typeId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
  }
  const result = await query(
    `SELECT id, sub_product_type_id AS type_id, name, icon, allowed_extensions,
       required, sort_order, created_at
     FROM sub_product_document_types
     WHERE sub_product_type_id = $1
     ORDER BY sort_order ASC, name ASC`,
    [typeId],
  );
  res.json(result.rows.map(documentTypeRow));
});

// POST /api/sub-product-types/:typeId/document-types
router.post(
  '/sub-product-types/:typeId/document-types',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
    }
    const data = documentTypePayloadSchema.parse(req.body);

    const typeExists = await query(`SELECT 1 FROM sub_product_types WHERE id = $1`, [typeId]);
    if (typeExists.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_NOT_FOUND });
    }

    try {
      const result = await query(
        `INSERT INTO sub_product_document_types
           (sub_product_type_id, name, icon, allowed_extensions, required, sort_order)
         VALUES (
           $1, $2, $3, $4::text[], $5,
           COALESCE((SELECT MAX(sort_order) + 1 FROM sub_product_document_types WHERE sub_product_type_id = $1), 0)
         )
         RETURNING id, sub_product_type_id AS type_id, name, icon, allowed_extensions,
           required, sort_order, created_at`,
        [typeId, data.name, data.icon, data.allowedExtensions, data.required],
      );
      res.status(201).json(documentTypeRow(result.rows[0]));
    } catch (err: any) {
      if (err?.code === '23505') {
        return res
          .status(409)
          .json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS });
      }
      throw err;
    }
  },
);

// PUT /api/sub-product-types/:typeId/document-types/reorder
router.put(
  '/sub-product-types/:typeId/document-types/reorder',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const typeId = Number(req.params.typeId);
    if (!typeId || Number.isNaN(typeId)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
    }
    const data = documentTypeReorderSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: number }>(
        `SELECT id FROM sub_product_document_types WHERE sub_product_type_id = $1`,
        [typeId],
      );
      const existingIds = new Set(existing.rows.map((r) => r.id));
      const incomingIds = new Set(data.orderedIds);
      const sameSet =
        existingIds.size === incomingIds.size &&
        [...existingIds].every((id) => incomingIds.has(id));

      if (!sameSet) {
        await client.query('ROLLBACK');
        return res
          .status(400)
          .json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_REORDER_MISMATCH });
      }

      for (let sortOrder = 0; sortOrder < data.orderedIds.length; sortOrder++) {
        await client.query(
          `UPDATE sub_product_document_types SET sort_order = $1
           WHERE id = $2 AND sub_product_type_id = $3`,
          [sortOrder, data.orderedIds[sortOrder], typeId],
        );
      }

      const result = await client.query(
        `SELECT id, sub_product_type_id AS type_id, name, icon, allowed_extensions,
           required, sort_order, created_at
         FROM sub_product_document_types
         WHERE sub_product_type_id = $1
         ORDER BY sort_order ASC, name ASC`,
        [typeId],
      );

      await client.query('COMMIT');
      res.json(result.rows.map(documentTypeRow));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

// PUT /api/sub-product-document-types/:id
router.put('/sub-product-document-types/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_DOCUMENT_TYPE_ID });
  }
  const data = documentTypePayloadSchema.parse(req.body);
  try {
    const result = await query(
      `UPDATE sub_product_document_types
       SET name = $1, icon = $2, allowed_extensions = $3::text[], required = $4
       WHERE id = $5
       RETURNING id, sub_product_type_id AS type_id, name, icon, allowed_extensions,
         required, sort_order, created_at`,
      [data.name, data.icon, data.allowedExtensions, data.required, id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_NOT_FOUND });
    }
    res.json(documentTypeRow(result.rows[0]));
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_ALREADY_EXISTS });
    }
    throw err;
  }
});

// DELETE /api/sub-product-document-types/:id
router.delete(
  '/sub-product-document-types/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_DOCUMENT_TYPE_ID });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const affected = await client.query(
        `SELECT COUNT(*)::int AS count FROM sub_product_revision_documents WHERE document_type_id = $1`,
        [id],
      );

      const result = await client.query(
        `DELETE FROM sub_product_document_types WHERE id = $1 RETURNING id`,
        [id],
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_DOCUMENT_TYPE_NOT_FOUND });
      }

      await client.query('COMMIT');
      res.json({ id, deleted: true, filesMovedToOther: affected.rows[0].count });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
);

export default router;
