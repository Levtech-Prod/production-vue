import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  productPayloadSchema,
  newRevisionSchema,
  setDefaultRevisionSchema,
  setProductStatusSchema,
  type ProductStatus,
} from '../schemas/products.schema.js';
import {
  logAudit,
  resolveActor,
  diffFields,
  valuesEqual,
} from '../services/audit.js';
import { carryForwardOnNewRevision } from '../services/documentFiles.js';
import { fileStagedImage, removeImageFile } from '../services/entityImages.js';

const router = Router();

// Write a product audit row in its own short transaction. Used for the rare
// reactivation-with-SKU-conflict path, whose retry loop can't run inside the
// main transaction (a 23505 aborts it). Best-effort: a logging failure must not
// fail the status change the user already made.
async function logProductAudit(
  productId: number,
  changes: Record<string, unknown>,
  userId: number | undefined,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actor = await resolveActor(client, userId);
    await logAudit(client, 'product', productId, 'updated', changes, actor);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to write product audit log', err);
  } finally {
    client.release();
  }
}

// How many "<sku>-N" candidates to try in resolveSkuConflictOnReactivate
// before giving up. Collisions are resolved on the first or second try in
// practice; this is just a sane upper bound against pathological data.
const MAX_SKU_SUFFIX_ATTEMPTS = 50;

/**
 * Reactivating a product can collide with a different active product that
 * has since taken its SKU (the unique index only covers active rows). Rather
 * than blocking the user with an error, free up a SKU automatically: strip
 * any suffix left over from a previous auto-resolve, then try "<sku>-2",
 * "<sku>-3", ... until one isn't taken, applying the status change together
 * with the winning SKU.
 *
 * Returns the updated row, or `null` if the product no longer exists.
 */
async function resolveSkuConflictOnReactivate(
  productId: number,
  status: ProductStatus,
) {
  const current = await query(`SELECT sku FROM products WHERE id = $1`, [
    productId,
  ]);
  if (current.rowCount === 0) return null;
  const baseSku = current.rows[0].sku.replace(/-\d+$/, '');

  for (let suffix = 2; suffix <= MAX_SKU_SUFFIX_ATTEMPTS; suffix++) {
    try {
      const result = await query(
        `UPDATE products SET status = $1, sku = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, sku, status, updated_at AS "updatedAt"`,
        [status, `${baseSku}-${suffix}`, productId],
      );
      return result.rows[0];
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      // candidate also taken — try the next suffix
    }
  }
  throw new Error(
    `No free SKU found for product ${productId} after ${MAX_SKU_SUFFIX_ATTEMPTS} attempts`,
  );
}

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
      p.status,
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

// POST /api/products — create product (no revision yet; the first revision
// is created the same way as any later one — see POST /:productId/revisions
// — once sub-products exist and are selected for it).
router.post('/', requireAuth, async (req, res) => {
  const data = productPayloadSchema.parse(req.body);
  const userId = req.user?.id;
  const client = await pool.connect();
  // Set once the image is on disk under the product's folder, so a later
  // rollback can take it back off again.
  let filedImage: string | null = null;
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
        data.type,
        data.description || null,
        data.image,
      ],
    );
    const product = productResult.rows[0];

    // The image was uploaded to `_tmp` before this row existed. Now that it has
    // an id, move it into the product's own folder and store the final path.
    const placed = fileStagedImage(product.image, product, null);
    if (placed === null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: ErrorCodes.STAGED_IMAGE_MISSING });
    }
    if (placed !== product.image) {
      filedImage = placed;
      await client.query(`UPDATE products SET image = $1 WHERE id = $2`, [
        placed,
        product.id,
      ]);
      product.image = placed;
    }

    const actor = await resolveActor(client, userId);
    await logAudit(client, 'product', product.id, 'created', {
      snapshot: { name: data.name, sku: data.sku, type: data.type },
    }, actor);

    await client.query('COMMIT');
    res.json({ ...product, revisions: [] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    // The move is not transactional; undo it so a failed create leaves no file.
    removeImageFile(filedImage);
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.PRODUCT_SKU_ALREADY_EXISTS });
    }
    // `type` must reference an existing product_types.name (see schema.sql).
    if (err?.code === '23503') {
      return res.status(422).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE });
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
    `SELECT id, name, sku, type, image, description, status,
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

  // All sub-products linked to this product (via sub_products.product_id),
  // with ALL their revisions — including sub-products that are not part of
  // any product revision yet.
  const subProductsResult = await query(
    `SELECT
       sp.id AS "id",
       sp.name AS "name",
       sp.sku AS "sku",
       sp.type AS "type",
       sp.image AS "image",
       sp.description AS "description",
       spr.id AS "revId",
       spr.revision_number AS "revNumber",
       spr.label AS "revLabel",
       spr.status AS "revStatus",
       spr.change_notes AS "revChangeNotes"
     FROM sub_products sp
     LEFT JOIN sub_product_revisions spr ON spr.sub_product_id = sp.id
     WHERE sp.product_id = $1
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
        description: row.description,
        revisions: [],
      });
    }
    if (row.revId != null) {
      subProductMap.get(row.id).revisions.push({
        id: row.revId,
        revisionNumber: row.revNumber,
        label: row.revLabel,
        status: row.revStatus,
        changeNotes: row.revChangeNotes,
      });
    }
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
  const data = newRevisionSchema.parse(req.body);

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

    // A product's first-ever revision has nothing to be "default" instead
    // of — make it the default automatically. (There's no delete endpoint
    // for product revisions, so revisionNumber === 1 reliably means this is
    // still the product's only revision, not a renumbered one.)
    if (newRevision.revisionNumber === 1) {
      await client.query(
        `UPDATE products SET default_revision_id = $1 WHERE id = $2`,
        [newRevision.id, productId],
      );
    }

    // When duplicating, copy the sub-product-revision links from the source.
    // The source must belong to THIS product — same ownership check
    // `resolveCarryForwardSource` applies to documents, so a foreign id
    // inherits nothing instead of seeding this revision from another product.
    if (data.duplicateFromId) {
      await client.query(
        `INSERT INTO product_revision_sub_products
           (product_revision_id, sub_product_revision_id, position)
         SELECT $1, prsp.sub_product_revision_id, prsp.position
         FROM product_revision_sub_products prsp
         JOIN product_revisions source ON source.id = prsp.product_revision_id
         WHERE prsp.product_revision_id = $2
           AND source.product_id = $3`,
        [newRevision.id, data.duplicateFromId, productId],
      );
    }

    // Carry-forward (document-system-plan.md §3.4): inherit the source
    // revision's documents — or, with no explicit source, the previous
    // revision's — by reference. Only rows are copied; the files themselves
    // stay stored once and are shared between the two revisions.
    await carryForwardOnNewRevision(
      client,
      'product',
      productId,
      newRevision.id,
      data.duplicateFromId,
      data.documentsFromId,
    );

    // Product-level log: a new revision was created.
    const actor = await resolveActor(client, req.user?.id);
    await logAudit(client, 'product', productId, 'updated', {
      events: [{ type: 'revision', tag: 'added', label: newRevision.label }],
    }, actor);

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
  const data = setDefaultRevisionSchema.parse(req.body);
  const userId = req.user?.id;

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE products SET default_revision_id = $1
       FROM (SELECT id, default_revision_id FROM products WHERE id = $2) old
       WHERE products.id = old.id
       RETURNING products.id, products.default_revision_id AS "defaultRevisionId",
         old.default_revision_id AS "oldDefaultRevisionId"`,
      [data.revisionId, productId],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }

    const row = result.rows[0];
    if (!valuesEqual(row.oldDefaultRevisionId, row.defaultRevisionId)) {
      // Resolve both ids to revision labels for a readable log entry.
      const labels = await client.query<{ id: number; label: string }>(
        `SELECT id, label FROM product_revisions WHERE id = ANY($1::int[])`,
        [[row.oldDefaultRevisionId, row.defaultRevisionId].filter((v) => v != null)],
      );
      const labelById = new Map(labels.rows.map((r) => [r.id, r.label]));
      const from = row.oldDefaultRevisionId != null
        ? labelById.get(row.oldDefaultRevisionId) ?? null : null;
      const to = row.defaultRevisionId != null
        ? labelById.get(row.defaultRevisionId) ?? null : null;
      const actor = await resolveActor(client, userId);
      await logAudit(client, 'product', productId, 'updated', {
        events: [{
          type: 'default_revision',
          tag: from && to ? 'changed' : to ? 'added' : 'removed',
          from,
          to,
        }],
      }, actor);
    }

    await client.query('COMMIT');
    const { oldDefaultRevisionId: _o, ...out } = row;
    res.json(out);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PATCH /api/products/:productId/status — archive or re-activate a product
router.patch('/:productId/status', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const data = setProductStatusSchema.parse(req.body);
  const userId = req.user?.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Capture the previous status so the audit records the transition.
    const result = await client.query(
      `UPDATE products SET status = $1, updated_at = NOW()
       FROM (SELECT id, status FROM products WHERE id = $2) old
       WHERE products.id = old.id
       RETURNING products.id, products.sku, products.status,
         products.updated_at AS "updatedAt", old.status AS "oldStatus"`,
      [data.status, productId],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }

    const row = result.rows[0];
    if (!valuesEqual(row.oldStatus, row.status)) {
      const actor = await resolveActor(client, userId);
      await logAudit(client, 'product', productId, 'updated', {
        fields: { status: { from: row.oldStatus, to: row.status } },
      }, actor);
    }

    await client.query('COMMIT');
    const { oldStatus: _prev, ...out } = row;
    return res.json(out);
  } catch (err: any) {
    await client.query('ROLLBACK');
    // Archiving never conflicts (archived rows sit outside the partial
    // unique index), so a 23505 here only happens on reactivation.
    if (err?.code !== '23505' || data.status !== 'active') {
      throw err;
    }
    const reactivated = await resolveSkuConflictOnReactivate(
      productId,
      data.status,
    );
    if (!reactivated) {
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }
    // The conflict path resolves outside the aborted transaction; record the
    // reactivation separately (best-effort).
    await logProductAudit(
      productId,
      { fields: { status: { from: 'archived', to: 'active' } } },
      userId,
    );
    return res.json(reactivated);
  } finally {
    client.release();
  }
});

// PATCH /api/products/:productId — update product fields
router.patch('/:productId', requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!productId || Number.isNaN(productId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_PRODUCT_ID });
  }
  const data = productPayloadSchema.parse(req.body);
  const userId = req.user?.id;
  const client = await pool.connect();
  let filedImage: string | null = null;

  try {
    await client.query('BEGIN');

    // Capture old + new in one statement (see parts.ts) for the audit diff.
    const result = await client.query(
      `UPDATE products
       SET name = $1, sku = $2, type = $3, description = $4, image = $5,
           updated_at = NOW()
       FROM (SELECT * FROM products WHERE id = $6) old
       WHERE products.id = old.id
       RETURNING products.id, products.name, products.sku, products.type,
         products.description, products.image,
         products.created_at AS "createdAt", products.updated_at AS "updatedAt",
         old.name        AS "oldName",
         old.sku         AS "oldSku",
         old.type        AS "oldType",
         old.description AS "oldDescription",
         old.image       AS "oldImage"`,
      [
        data.name,
        data.sku,
        data.type,
        data.description || null,
        data.image,
        productId,
      ],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }

    const row = result.rows[0];

    const placed = fileStagedImage(row.image, row, null);
    if (placed === null) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: ErrorCodes.STAGED_IMAGE_MISSING });
    }
    if (placed !== row.image) {
      filedImage = placed;
      await client.query(`UPDATE products SET image = $1 WHERE id = $2`, [
        placed,
        productId,
      ]);
      row.image = placed;
    }

    const fields = diffFields(
      { name: row.oldName, sku: row.oldSku, type: row.oldType, description: row.oldDescription },
      { name: row.name, sku: row.sku, type: row.type, description: row.description },
      ['name', 'sku', 'type', 'description'],
    ) as Record<string, { from: unknown; to: unknown }>;

    if (!valuesEqual(row.oldImage, row.image)) {
      fields.image = {
        from: row.oldImage ? '(image)' : null,
        to: row.image ? '(image)' : null,
      };
    }

    if (Object.keys(fields).length > 0) {
      const actor = await resolveActor(client, userId);
      await logAudit(client, 'product', productId, 'updated', { fields }, actor);
    }

    await client.query('COMMIT');

    // Post-commit, like `unlinkStoredFile`: an unlink cannot be rolled back, so
    // the replaced file only goes once the new one is durably recorded.
    if (!valuesEqual(row.oldImage, row.image)) removeImageFile(row.oldImage);

    const {
      oldName: _on,
      oldSku: _os,
      oldType: _ot,
      oldDescription: _od,
      oldImage: _oi,
      ...productOut
    } = row;
    res.json(productOut);
  } catch (err: any) {
    await client.query('ROLLBACK');
    removeImageFile(filedImage);
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.PRODUCT_SKU_ALREADY_EXISTS });
    }
    // `type` must reference an existing product_types.name (see schema.sql).
    if (err?.code === '23503') {
      return res.status(422).json({ code: ErrorCodes.INVALID_PRODUCT_TYPE });
    }
    throw err;
  } finally {
    client.release();
  }
});

export default router;
