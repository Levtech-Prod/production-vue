import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import { productTypePayloadSchema } from '../schemas/productTypes.schema.js';

const router = Router();

// GET /api/product-types — any logged-in user (needed to populate the
// product/sub-product "type" select), managing the list itself is admin-only.
router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT id, name, created_at AS "createdAt"
     FROM product_types
     ORDER BY name ASC`,
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const data = productTypePayloadSchema.parse(req.body);
  try {
    const result = await query(
      `INSERT INTO product_types (name) VALUES ($1)
       RETURNING id, name, created_at AS "createdAt"`,
      [data.name],
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.PRODUCT_TYPE_ALREADY_EXISTS });
    }
    throw err;
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
  }
  const data = productTypePayloadSchema.parse(req.body);
  try {
    // Renaming cascades to products.type via the FK's ON UPDATE CASCADE.
    const result = await query(
      `UPDATE product_types SET name = $1 WHERE id = $2
       RETURNING id, name, created_at AS "createdAt"`,
      [data.name, id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_TYPE_NOT_FOUND });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ code: ErrorCodes.PRODUCT_TYPE_ALREADY_EXISTS });
    }
    throw err;
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE_ID });
  }
  try {
    const result = await query(
      `DELETE FROM product_types WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_TYPE_NOT_FOUND });
    }
    res.json({ id, deleted: true });
  } catch (err: any) {
    // No ON DELETE clause on products_type_fkey defaults to RESTRICT — a
    // type still assigned to a product raises a foreign_key_violation.
    if (err?.code === '23503') {
      return res.status(409).json({ code: ErrorCodes.PRODUCT_TYPE_IN_USE });
    }
    throw err;
  }
});

export default router;
