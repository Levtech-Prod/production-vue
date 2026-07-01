import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';

const router = Router();

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  status: z.enum(['draft', 'active', 'deprecated']).optional(),
  changeNotes: z.string().optional().nullable(),
});

const subProductsSchema = z.object({
  subProductRevisionIds: z.array(z.number()),
});

// GET /api/product-revisions/compare?a=&b= — structured diff (server-side).
// Registered before /:revId routes so the literal path takes precedence.
router.get('/compare', requireAuth, async (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);
  if (!a || !b || Number.isNaN(a) || Number.isNaN(b)) {
    return res.status(400).json({ code: ErrorCodes.COMPARE_INVALID_PARAMS });
  }

  // Sub-product revisions belonging to each of the two product revisions.
  const rowsResult = await query(
    `SELECT
       prsp.product_revision_id AS "productRevisionId",
       sp.id AS "subProductId",
       sp.name AS "subProductName",
       sp.sku AS "subProductSku",
       spr.id AS "subProductRevisionId",
       spr.revision_number AS "revisionNumber",
       spr.label AS "revisionLabel",
       spr.status AS "revisionStatus"
     FROM product_revision_sub_products prsp
     JOIN sub_product_revisions spr ON spr.id = prsp.sub_product_revision_id
     JOIN sub_products sp ON sp.id = spr.sub_product_id
     WHERE prsp.product_revision_id IN ($1, $2)`,
    [a, b],
  );

  type Side = {
    subProductRevisionId: number;
    revisionNumber: number;
    revisionLabel: string;
    revisionStatus: string;
  } | null;

  const map = new Map<
    number,
    { subProductId: number; name: string; sku: string; inA: Side; inB: Side }
  >();

  for (const row of rowsResult.rows) {
    if (!map.has(row.subProductId)) {
      map.set(row.subProductId, {
        subProductId: row.subProductId,
        name: row.subProductName,
        sku: row.subProductSku,
        inA: null,
        inB: null,
      });
    }
    const entry = map.get(row.subProductId)!;
    const side: Side = {
      subProductRevisionId: row.subProductRevisionId,
      revisionNumber: row.revisionNumber,
      revisionLabel: row.revisionLabel,
      revisionStatus: row.revisionStatus,
    };
    if (row.productRevisionId === a) entry.inA = side;
    if (row.productRevisionId === b) entry.inB = side;
  }

  const subProducts = Array.from(map.values()).map((e) => {
    let status: 'added' | 'removed' | 'changed' | 'unchanged';
    if (e.inA && !e.inB) status = 'removed';
    else if (!e.inA && e.inB) status = 'added';
    else if (
      e.inA &&
      e.inB &&
      e.inA.subProductRevisionId !== e.inB.subProductRevisionId
    )
      status = 'changed';
    else status = 'unchanged';
    return { ...e, status };
  });

  res.json({ a, b, subProducts });
});

// PATCH /api/product-revisions/:revId — update status, change_notes, label
router.patch('/:revId', requireAuth, async (req, res) => {
  const revId = Number(req.params.revId);
  if (!revId || Number.isNaN(revId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  }
  const data = patchSchema.parse(req.body);

  // Build a dynamic SET clause from only the provided fields.
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (data.label !== undefined) {
    fields.push(`label = $${i++}`);
    values.push(data.label);
  }
  if (data.status !== undefined) {
    fields.push(`status = $${i++}`);
    values.push(data.status);
  }
  if (data.changeNotes !== undefined) {
    fields.push(`change_notes = $${i++}`);
    values.push(data.changeNotes || null);
  }
  if (fields.length === 0) {
    return res.status(400).json({ code: ErrorCodes.REVISION_UPDATE_FAILED });
  }
  values.push(revId);

  try {
    const result = await query(
      `UPDATE product_revisions
       SET ${fields.join(', ')}
       WHERE id = $${i}
       RETURNING id, product_id AS "productId",
         revision_number AS "revisionNumber", label, status,
         change_notes AS "changeNotes", created_at AS "createdAt"`,
      values,
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: ErrorCodes.REVISION_UPDATE_FAILED });
  }
});

// PATCH /api/product-revisions/:revId/sub-products — replace the linked set
router.patch('/:revId/sub-products', requireAuth, async (req, res) => {
  const revId = Number(req.params.revId);
  if (!revId || Number.isNaN(revId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  }
  const data = subProductsSchema.parse(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const revExists = await client.query(
      `SELECT id FROM product_revisions WHERE id = $1`,
      [revId],
    );
    if (revExists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    await client.query(
      `DELETE FROM product_revision_sub_products WHERE product_revision_id = $1`,
      [revId],
    );

    let position = 0;
    for (const sprId of data.subProductRevisionIds) {
      await client.query(
        `INSERT INTO product_revision_sub_products
           (product_revision_id, sub_product_revision_id, position)
         VALUES ($1, $2, $3)`,
        [revId, sprId, position++],
      );
    }

    await client.query('COMMIT');

    const result = await client.query(
      `SELECT sub_product_revision_id AS "subProductRevisionId", position
       FROM product_revision_sub_products
       WHERE product_revision_id = $1
       ORDER BY position`,
      [revId],
    );
    res.json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
