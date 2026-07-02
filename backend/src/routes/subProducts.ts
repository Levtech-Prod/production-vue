import { Router } from 'express';
import { z } from 'zod';
import { query, pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';

const router = Router();

const createSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(1),
  type: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
});

const revisionSchema = z.object({
  label: z.string().min(1),
  changeNotes: z.string().optional().nullable(),
  duplicateFromId: z.number().optional().nullable(),
  parts: z
    .array(
      z.object({
        partId: z.number(),
        quantity: z.number(),
        unit: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      }),
    )
    .optional()
    .default([]),
});

// GET /api/sub-products — list all (for picker modal)
router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      sp.id,
      sp.name,
      sp.sku,
      sp.type,
      sp.image,
      sp.description,
      sp.created_at AS "createdAt",
      sp.updated_at AS "updatedAt",
      COALESCE(
        json_agg(
          json_build_object(
            'id', spr.id,
            'revisionNumber', spr.revision_number,
            'label', spr.label,
            'status', spr.status
          ) ORDER BY spr.revision_number
        ) FILTER (WHERE spr.id IS NOT NULL),
        '[]'
      ) AS revisions
     FROM sub_products sp
     LEFT JOIN sub_product_revisions spr ON spr.sub_product_id = sp.id
     GROUP BY sp.id
     ORDER BY sp.name ASC`,
  );
  res.json(result.rows);
});

// POST /api/sub-products — create sub-product + auto-create revision 1
router.post('/', requireAuth, async (req, res) => {
  const data = createSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const spResult = await client.query(
      `INSERT INTO sub_products (name, sku, type, description, image)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, sku, type, description, image,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        data.name,
        data.sku,
        data.type || null,
        data.description || null,
        data.image || null,
      ],
    );
    const subProduct = spResult.rows[0];

    const revResult = await client.query(
      `INSERT INTO sub_product_revisions (sub_product_id, revision_number, label, status)
       VALUES ($1, 1, 'Rev. 1', 'draft')
       RETURNING id, revision_number AS "revisionNumber", label, status`,
      [subProduct.id],
    );

    await client.query('COMMIT');
    res.json({ ...subProduct, revisions: [revResult.rows[0]] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.SUB_PRODUCT_SKU_ALREADY_EXISTS });
    }
    throw err;
  } finally {
    client.release();
  }
});

// PATCH /api/sub-products/:spId — update sub-product fields
router.patch('/:spId', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  if (!spId || Number.isNaN(spId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
  }
  const data = createSchema.parse(req.body);

  try {
    const result = await query(
      `UPDATE sub_products
       SET name = $1, sku = $2, type = $3, description = $4, image = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, sku, type, description, image,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        data.name,
        data.sku,
        data.type || null,
        data.description || null,
        data.image || null,
        spId,
      ],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_NOT_FOUND });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.SUB_PRODUCT_SKU_ALREADY_EXISTS });
    }
    throw err;
  }
});

// POST /api/sub-products/:spId/revisions — new revision (parts + optional duplicate)
router.post('/:spId/revisions', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  if (!spId || Number.isNaN(spId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
  }
  const data = revisionSchema.parse(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const spExists = await client.query(
      `SELECT id FROM sub_products WHERE id = $1`,
      [spId],
    );
    if (spExists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_NOT_FOUND });
    }

    const newRevResult = await client.query(
      `INSERT INTO sub_product_revisions (sub_product_id, revision_number, label, status, change_notes)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(revision_number), 0) + 1
            FROM sub_product_revisions WHERE sub_product_id = $1),
         $2, 'draft', $3
       )
       RETURNING id, revision_number AS "revisionNumber", label, status,
         change_notes AS "changeNotes", created_at AS "createdAt"`,
      [spId, data.label, data.changeNotes || null],
    );
    const newRevision = newRevResult.rows[0];

    // Copy parts from a source revision when duplicating.
    if (data.duplicateFromId) {
      await client.query(
        `INSERT INTO sub_product_revision_parts
           (sub_product_revision_id, part_id, quantity, unit, notes)
         SELECT $1, part_id, quantity, unit, notes
         FROM sub_product_revision_parts
         WHERE sub_product_revision_id = $2`,
        [newRevision.id, data.duplicateFromId],
      );
    }

    // Explicitly provided parts are inserted (and override duplicated ones
    // for the same part via upsert).
    for (const part of data.parts) {
      await client.query(
        `INSERT INTO sub_product_revision_parts
           (sub_product_revision_id, part_id, quantity, unit, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (sub_product_revision_id, part_id)
         DO UPDATE SET quantity = EXCLUDED.quantity,
                       unit = EXCLUDED.unit,
                       notes = EXCLUDED.notes`,
        [
          newRevision.id,
          part.partId,
          part.quantity,
          part.unit || null,
          part.notes || null,
        ],
      );
    }

    await client.query('COMMIT');
    res.json(newRevision);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/sub-products/:spId/revisions/:revId/parts — parts for one revision
router.get('/:spId/revisions/:revId/parts', requireAuth, async (req, res) => {
  const revId = Number(req.params.revId);
  if (!revId || Number.isNaN(revId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  }
  const result = await query(
    `SELECT
       p.id,
       p.name,
       p.code,
       p.category_id AS "categoryId",
       p.price_per_piece AS "pricePerPiece",
       p.image,
       sprp.quantity,
       sprp.unit,
       sprp.notes
     FROM sub_product_revision_parts sprp
     JOIN parts p ON p.id = sprp.part_id
     WHERE sprp.sub_product_revision_id = $1
     ORDER BY p.name`,
    [revId],
  );
  res.json(result.rows);
});

export default router;
