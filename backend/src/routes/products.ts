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

const updateSchema = z.object({
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
});

// GET /api/products — list with latest revision info
router.get('/', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT
      p.id,
      p.name,
      p.sku,
      p.type,
      p.image,
      p.description,
      p.default_revision_id AS "defaultRevisionId",
      p.created_at AS "createdAt",
      p.updated_at AS "updatedAt",
      COALESCE(
        json_agg(
          json_build_object(
            'id', pr.id,
            'revisionNumber', pr.revision_number,
            'label', pr.label,
            'status', pr.status
          ) ORDER BY pr.revision_number
        ) FILTER (WHERE pr.id IS NOT NULL),
        '[]'
      ) AS revisions
     FROM products p
     LEFT JOIN product_revisions pr ON pr.product_id = p.id
     GROUP BY p.id
     ORDER BY p.name ASC`,
  );
  res.json(result.rows);
});

// POST /api/products — create product + auto-create revision 1
router.post('/', requireAuth, async (req, res) => {
  const data = createSchema.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const productResult = await client.query(
      `INSERT INTO products (name, sku, type, description, image)
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
    const product = productResult.rows[0];

    const revisionResult = await client.query(
      `INSERT INTO product_revisions (product_id, revision_number, label, status)
       VALUES ($1, 1, 'Rev. 1', 'draft')
       RETURNING id, revision_number AS "revisionNumber", label, status`,
      [product.id],
    );

    await client.query('COMMIT');
    res.json({ ...product, revisions: [revisionResult.rows[0]] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.PRODUCT_SKU_ALREADY_EXISTS });
    }
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/products/:productId — full detail (product + sub-products + revisions)
router.get('/:productId', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }

  const productResult = await query(
    `SELECT id, name, sku, type, image, description,
       default_revision_id AS "defaultRevisionId",
       created_at AS "createdAt", updated_at AS "updatedAt"
     FROM products WHERE id = $1`,
    [productId],
  );
  if (productResult.rowCount === 0) {
    return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
  }
  const product = productResult.rows[0];

  // Product revisions (for the pills UI)
  const revisionsResult = await query(
    `SELECT id, revision_number AS "revisionNumber", label, status,
       change_notes AS "changeNotes", created_at AS "createdAt"
     FROM product_revisions
     WHERE product_id = $1
     ORDER BY revision_number`,
    [productId],
  );

  // Which sub-product revisions belong to each product revision
  const membershipResult = await query(
    `SELECT prsp.product_revision_id AS "productRevisionId",
       prsp.sub_product_revision_id AS "subProductRevisionId",
       prsp.position
     FROM product_revision_sub_products prsp
     JOIN product_revisions pr ON pr.id = prsp.product_revision_id
     WHERE pr.product_id = $1
     ORDER BY prsp.position`,
    [productId],
  );

  // All sub-products (and their revisions) referenced by any of this
  // product's revisions.
  const subProductsResult = await query(
    `SELECT DISTINCT
       sp.id AS "id",
       sp.name AS "name",
       sp.sku AS "sku",
       sp.type AS "type",
       sp.image AS "image",
       spr.id AS "revId",
       spr.revision_number AS "revNumber",
       spr.label AS "revLabel",
       spr.status AS "revStatus",
       spr.change_notes AS "revChangeNotes"
     FROM product_revision_sub_products prsp
     JOIN product_revisions pr ON pr.id = prsp.product_revision_id
     JOIN sub_product_revisions spr ON spr.id = prsp.sub_product_revision_id
     JOIN sub_products sp ON sp.id = spr.sub_product_id
     WHERE pr.product_id = $1
     ORDER BY sp.name, spr.revision_number`,
    [productId],
  );

  // Collapse the flat sub-product/revision rows into a nested structure.
  const subProductMap = new Map<number, any>();
  for (const row of subProductsResult.rows) {
    if (!subProductMap.has(row.id)) {
      subProductMap.set(row.id, {
        id: row.id,
        name: row.name,
        sku: row.sku,
        type: row.type,
        image: row.image,
        revisions: [],
      });
    }
    subProductMap.get(row.id).revisions.push({
      id: row.revId,
      revisionNumber: row.revNumber,
      label: row.revLabel,
      status: row.revStatus,
      changeNotes: row.revChangeNotes,
    });
  }

  res.json({
    ...product,
    revisions: revisionsResult.rows,
    membership: membershipResult.rows,
    subProducts: Array.from(subProductMap.values()),
  });
});

// GET /api/products/:productId/revisions — just the revision list
router.get('/:productId/revisions', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const result = await query(
    `SELECT id, revision_number AS "revisionNumber", label, status,
       change_notes AS "changeNotes", created_at AS "createdAt"
     FROM product_revisions
     WHERE product_id = $1
     ORDER BY revision_number`,
    [productId],
  );
  res.json(result.rows);
});

// POST /api/products/:productId/revisions — new revision (optionally duplicate)
router.post('/:productId/revisions', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const data = revisionSchema.parse(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const productExists = await client.query(
      `SELECT id FROM products WHERE id = $1`,
      [productId],
    );
    if (productExists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }

    const newRevResult = await client.query(
      `INSERT INTO product_revisions (product_id, revision_number, label, status, change_notes)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(revision_number), 0) + 1
            FROM product_revisions WHERE product_id = $1),
         $2, 'draft', $3
       )
       RETURNING id, revision_number AS "revisionNumber", label, status,
         change_notes AS "changeNotes", created_at AS "createdAt"`,
      [productId, data.label, data.changeNotes || null],
    );
    const newRevision = newRevResult.rows[0];

    // When duplicating, copy the sub-product-revision links from the source.
    if (data.duplicateFromId) {
      await client.query(
        `INSERT INTO product_revision_sub_products
           (product_revision_id, sub_product_revision_id, position)
         SELECT $1, sub_product_revision_id, position
         FROM product_revision_sub_products
         WHERE product_revision_id = $2`,
        [newRevision.id, data.duplicateFromId],
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

// PATCH /api/products/:productId/default-revision — set/clear default revision
router.patch('/:productId/default-revision', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const data = z
    .object({ revisionId: z.number().nullable() })
    .parse(req.body);

  // When setting (not clearing), the revision must belong to this product.
  if (data.revisionId != null) {
    const check = await query(
      `SELECT id FROM product_revisions WHERE id = $1 AND product_id = $2`,
      [data.revisionId, productId],
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }
  }

  const result = await query(
    `UPDATE products SET default_revision_id = $1 WHERE id = $2
     RETURNING id, default_revision_id AS "defaultRevisionId"`,
    [data.revisionId, productId],
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
  }
  res.json(result.rows[0]);
});

// PATCH /api/products/:productId — update product fields
router.patch('/:productId', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const data = updateSchema.parse(req.body);

  try {
    const result = await query(
      `UPDATE products
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
        productId,
      ],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.PRODUCT_SKU_ALREADY_EXISTS });
    }
    throw err;
  }
});

export default router;
