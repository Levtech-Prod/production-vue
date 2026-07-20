import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { subProductTypePayloadSchema } from '../schemas/subProductTypes.schema.js';

const router = Router();

// GET /api/sub-product-types — any logged-in user (needed to populate the
// sub-product "type" select), managing the list itself is admin-only.
router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT id, name, created_at AS "createdAt"
     FROM sub_product_types
     ORDER BY name ASC`,
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const data = subProductTypePayloadSchema.parse(req.body);
  try {
    const result = await query(
      `INSERT INTO sub_product_types (name) VALUES ($1)
       RETURNING id, name, created_at AS "createdAt"`,
      [data.name],
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_ALREADY_EXISTS });
    }
    throw err;
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
  }
  const data = subProductTypePayloadSchema.parse(req.body);
  try {
    // Renaming cascades to sub_products.type via the FK's ON UPDATE CASCADE.
    const result = await query(
      `UPDATE sub_product_types SET name = $1 WHERE id = $2
       RETURNING id, name, created_at AS "createdAt"`,
      [data.name, id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_NOT_FOUND });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_ALREADY_EXISTS });
    }
    throw err;
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE_ID });
  }
  try {
    const result = await query(
      `DELETE FROM sub_product_types WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_NOT_FOUND });
    }
    res.json({ id, deleted: true });
  } catch (err: any) {
    // No ON DELETE clause on sub_products_type_fkey defaults to RESTRICT — a
    // type still assigned to a sub-product raises a foreign_key_violation.
    if (err?.code === '23503') {
      return res.status(409).json({ code: ErrorCodes.SUB_PRODUCT_TYPE_IN_USE });
    }
    throw err;
  }
});

export default router;
