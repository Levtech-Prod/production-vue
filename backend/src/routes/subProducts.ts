import { Router } from 'express';
import type { PoolClient } from 'pg';
import { query, pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { removeFirmwareDirs } from '../services/uploadPaths.js';
import { findRevisionContext } from '../services/firmwareFiles.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  createSubProductSchema,
  subProductPayloadSchema,
  newSubProductRevisionSchema,
  replaceRevisionPartsSchema,
} from '../schemas/subProducts.schema.js';
import { revisionUpdateSchema } from '../schemas/revisions.schema.js';
import {
  logAudit,
  resolveActor,
  valuesEqual,
  type AuditEvent,
  type AuditScope,
} from '../services/audit.js';
import {
  carryForwardOnNewRevision,
  removeEntityFolder,
  type Queryable,
} from '../services/documentFiles.js';
import { fileStagedImage, removeImageFile } from '../services/entityImages.js';
import type { FolderEntity } from '../services/uploadPaths.js';

const router = Router();

/** The owning product's folder identity, or null when it is unknown. */
async function findFolderProduct(
  db: Queryable,
  productId: number,
): Promise<FolderEntity | null> {
  const result = await db.query<FolderEntity>(
    `SELECT id, name, sku FROM products WHERE id = $1`,
    [productId],
  );
  return result.rows[0] ?? null;
}

// Compact descriptor of a BOM line's fields (quantity, unit, mount position,
// notes) for the product log. The part name is carried separately as the event
// label, so it is not repeated here.
function bomLineDetails(
  quantity: number | null,
  unit: string | null,
  notes: string | null,
  mountPosition: string | null,
): string {
  const bits: string[] = [];
  if (quantity != null) bits.push(`× ${quantity}`);
  if (unit) bits.push(unit);
  if (mountPosition) bits.push(`@ ${mountPosition}`);
  if (notes) bits.push(`"${notes}"`);
  return bits.join(' · ');
}

// A BOM line as accepted from a request payload.
interface RevisionPartInput {
  partId: number;
  quantity: number;
  unit?: string | null;
  notes?: string | null;
  mountPosition?: string | null;
}

/**
 * Upsert a revision's BOM lines in a single round-trip. Duplicate part ids in
 * the payload are collapsed last-wins (matching the old per-row upsert loop),
 * which also avoids Postgres' "ON CONFLICT cannot affect row a second time"
 * error that a naive batched upsert would hit on duplicates. The ON CONFLICT
 * clause still overrides rows copied from a duplicated source revision.
 */
async function insertRevisionParts(
  client: PoolClient,
  revisionId: number,
  parts: RevisionPartInput[],
): Promise<void> {
  if (parts.length === 0) return;
  const byPart = new Map<number, RevisionPartInput>();
  for (const p of parts) byPart.set(p.partId, p);
  const lines = Array.from(byPart.values());
  await client.query(
    `INSERT INTO sub_product_revision_parts
       (sub_product_revision_id, part_id, quantity, unit, notes, mount_position)
     SELECT $1, part_id, quantity, unit, notes, mount_position
     FROM unnest($2::int[], $3::numeric[], $4::text[], $5::text[], $6::text[])
       AS t(part_id, quantity, unit, notes, mount_position)
     ON CONFLICT (sub_product_revision_id, part_id)
     DO UPDATE SET quantity = EXCLUDED.quantity,
                   unit = EXCLUDED.unit,
                   notes = EXCLUDED.notes,
                   mount_position = EXCLUDED.mount_position`,
    [
      revisionId,
      lines.map((p) => p.partId),
      lines.map((p) => p.quantity),
      lines.map((p) => p.unit || null),
      lines.map((p) => p.notes || null),
      lines.map((p) => p.mountPosition || null),
    ],
  );
}

// GET /api/sub-products/revisions/compare?a=&b= — parts diff between two sub-product revisions.
// Registered before /:spId routes so the literal path takes precedence.
router.get('/revisions/compare', requireAuth, async (req, res) => {
  const a = Number(req.query.a);
  const b = Number(req.query.b);
  if (!a || !b || Number.isNaN(a) || Number.isNaN(b)) {
    return res.status(400).json({ code: ErrorCodes.COMPARE_INVALID_PARAMS });
  }

  const rowsResult = await query(
    `SELECT
       sprp.sub_product_revision_id AS "revisionId",
       p.id                          AS "partId",
       p.name,
       p.code,
       p.image,
       p.price_per_piece            AS "pricePerPiece",
       pc.name                      AS "categoryName",
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'name', pcp.name,
               'value', spv.value,
               'unit', pcp.unit,
               'type', pcp.type
             ) ORDER BY pcp.id
           )
           FROM stock_parameters spv
           JOIN part_category_parameters pcp ON pcp.id = spv.parameter_id
           WHERE spv.part_id = p.id
         ),
         '[]'
       ) AS parameters,
       sprp.quantity::integer AS quantity,
       sprp.unit,
       sprp.notes,
       sprp.mount_position AS "mountPosition"
     FROM sub_product_revision_parts sprp
     JOIN parts p ON p.id = sprp.part_id
     JOIN part_categories pc ON pc.id = p.category_id
     WHERE sprp.sub_product_revision_id IN ($1, $2)
     ORDER BY p.name`,
    [a, b],
  );

  type PartSide = {
    quantity: number;
    unit: string | null;
    notes: string | null;
    mountPosition: string | null;
  } | null;
  type PartParameter = { name: string; value: string; unit: string | null; type: string };

  const map = new Map<
    number,
    {
      partId: number;
      name: string;
      code: string;
      image: string | null;
      pricePerPiece: number | string | null;
      categoryName: string | null;
      parameters: PartParameter[];
      inA: PartSide;
      inB: PartSide;
    }
  >();

  for (const row of rowsResult.rows) {
    if (!map.has(row.partId)) {
      map.set(row.partId, {
        partId: row.partId,
        name: row.name,
        code: row.code,
        image: row.image ?? null,
        pricePerPiece: row.pricePerPiece ?? null,
        categoryName: row.categoryName ?? null,
        parameters: row.parameters ?? [],
        inA: null,
        inB: null,
      });
    }
    const entry = map.get(row.partId)!;
    const side: PartSide = {
      quantity: row.quantity,
      unit: row.unit ?? null,
      notes: row.notes ?? null,
      mountPosition: row.mountPosition ?? null,
    };
    if (row.revisionId === a) entry.inA = side;
    if (row.revisionId === b) entry.inB = side;
  }

  const parts = Array.from(map.values()).map((e) => {
    let status: 'added' | 'removed' | 'changed' | 'unchanged';
    if (e.inA && !e.inB) status = 'removed';
    else if (!e.inA && e.inB) status = 'added';
    else if (
      e.inA &&
      e.inB &&
      (String(e.inA.quantity) !== String(e.inB.quantity) ||
        (e.inA.unit ?? '') !== (e.inB.unit ?? '') ||
        (e.inA.mountPosition ?? '') !== (e.inB.mountPosition ?? ''))
    )
      status = 'changed';
    else status = 'unchanged';
    return { ...e, status };
  });

  res.json({ a, b, parts });
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
  const data = createSubProductSchema.parse(req.body);
  const client = await pool.connect();
  let filedImage: string | null = null;
  try {
    await client.query('BEGIN');

    const spResult = await client.query(
      `INSERT INTO sub_products (product_id, name, sku, type, description, image)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, product_id AS "productId", name, sku, type, description, image,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        data.productId,
        data.name,
        data.sku || null,
        data.type,
        data.description || null,
        data.image || null,
      ],
    );
    const subProduct = spResult.rows[0];

    // A sub-product's folder lives inside its product's, so the parent has to
    // be resolved before the staged image can be filed.
    const parent = await findFolderProduct(client, data.productId);
    if (!parent) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }
    // Image is optional now — only a present value needs filing.
    const placed: string | null = subProduct.image
      ? fileStagedImage(subProduct.image, subProduct, parent)
      : null;
    if (placed === null && subProduct.image) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: ErrorCodes.STAGED_IMAGE_MISSING });
    }
    if (placed !== subProduct.image) {
      filedImage = placed;
      await client.query(`UPDATE sub_products SET image = $1 WHERE id = $2`, [
        placed,
        subProduct.id,
      ]);
      subProduct.image = placed;
    }

    const revResult = await client.query(
      `INSERT INTO sub_product_revisions (sub_product_id, revision_number, label, status)
       VALUES ($1, 1, 'Rev. 1', 'draft')
       RETURNING id, revision_number AS "revisionNumber", label, status`,
      [subProduct.id],
    );
    const rev1 = revResult.rows[0];

    // Attach any parts chosen at creation time to Rev. 1.
    await insertRevisionParts(client, rev1.id, data.parts);

    // Product-level log: a new sub-product was added (name only, by request).
    const actor = await resolveActor(client, req.user?.id);
    await logAudit(client, 'product', data.productId, 'updated', {
      events: [{ type: 'sub_product', tag: 'added', label: subProduct.name }],
    }, actor);

    await client.query('COMMIT');
    res.json({ ...subProduct, revisions: [rev1] });
  } catch (err: any) {
    await client.query('ROLLBACK');
    removeImageFile(filedImage);
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.SUB_PRODUCT_SKU_ALREADY_EXISTS });
    }
    // `type` must reference an existing sub_product_types.name (see schema.sql).
    if (err?.code === '23503') {
      return res.status(422).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE });
    }
    throw err;
  } finally {
    client.release();
  }
});

// PATCH /api/sub-products/:spId — update sub-product fields (admin only)
router.patch('/:spId', requireAuth, requireAdmin, async (req, res) => {
  const spId = Number(req.params.spId);
  if (!spId || Number.isNaN(spId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
  }
  const data = subProductPayloadSchema.parse(req.body);
  const client = await pool.connect();
  let filedImage: string | null = null;

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE sub_products
       SET name = $1, sku = $2, type = $3, description = $4, image = $5,
           updated_at = NOW()
       FROM (SELECT image, product_id FROM sub_products WHERE id = $6) old
       WHERE sub_products.id = $6
       RETURNING sub_products.id, sub_products.name, sub_products.sku,
         sub_products.type, sub_products.description, sub_products.image,
         sub_products.created_at AS "createdAt",
         sub_products.updated_at AS "updatedAt",
         old.image      AS "oldImage",
         old.product_id AS "productId"`,
      [
        data.name,
        data.sku || null,
        data.type,
        data.description || null,
        data.image || null,
        spId,
      ],
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_NOT_FOUND });
    }

    const row = result.rows[0];
    const parent = await findFolderProduct(client, row.productId);
    if (!parent) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.PRODUCT_NOT_FOUND });
    }

    // Image is optional now — only a present value needs filing.
    const placed: string | null = row.image
      ? fileStagedImage(row.image, row, parent)
      : null;
    if (placed === null && row.image) {
      await client.query('ROLLBACK');
      return res.status(400).json({ code: ErrorCodes.STAGED_IMAGE_MISSING });
    }
    if (placed !== row.image) {
      filedImage = placed;
      await client.query(`UPDATE sub_products SET image = $1 WHERE id = $2`, [
        placed,
        spId,
      ]);
      row.image = placed;
    }

    await client.query('COMMIT');
    if (row.oldImage !== row.image) removeImageFile(row.oldImage);

    const { oldImage: _oi, productId: _pid, ...subProductOut } = row;
    res.json(subProductOut);
  } catch (err: any) {
    await client.query('ROLLBACK');
    removeImageFile(filedImage);
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ code: ErrorCodes.SUB_PRODUCT_SKU_ALREADY_EXISTS });
    }
    // `type` must reference an existing sub_product_types.name (see schema.sql).
    if (err?.code === '23503') {
      return res.status(422).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_TYPE });
    }
    throw err;
  }
});

// DELETE /api/sub-products/:spId — delete a whole sub-product.
// Cascades (see schema.sql FKs) remove its revisions, their parts,
// documents, and any product-revision membership links.
router.delete('/:spId', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  if (!spId || Number.isNaN(spId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
  }
  // Read the folder identity before the row is gone — afterwards there is
  // nothing left to derive the path from.
  const existing = await query<{
    id: number;
    name: string;
    sku: string | null;
    productId: number | null;
  }>(
    `SELECT id, name, sku, product_id AS "productId" FROM sub_products WHERE id = $1`,
    [spId],
  );
  const subProduct = existing.rows[0];
  if (!subProduct) {
    return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_NOT_FOUND });
  }

  const parent =
    subProduct.productId === null ? null : await findFolderProduct(pool, subProduct.productId);

  const result = await query(
    `DELETE FROM sub_products WHERE id = $1 RETURNING id`,
    [spId],
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ code: ErrorCodes.SUB_PRODUCT_NOT_FOUND });
  }

  // Post-delete: the cascade has removed every row pointing into this folder,
  // so the whole thing goes. Previously these files were left behind on disk.
  // Firmware sits inside this folder too (`documents/firmware/`), so it goes
  // with it — no separate sweep needed.
  if (parent) removeEntityFolder({ ...subProduct, product: parent });

  res.json({ id: spId, deleted: true });
});

// POST /api/sub-products/:spId/revisions — new revision (parts + optional duplicate)
router.post('/:spId/revisions', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  if (!spId || Number.isNaN(spId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_SUB_PRODUCT_ID });
  }
  const data = newSubProductRevisionSchema.parse(req.body);

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
           (sub_product_revision_id, part_id, quantity, unit, notes, mount_position)
         SELECT $1, part_id, quantity, unit, notes, mount_position
         FROM sub_product_revision_parts
         WHERE sub_product_revision_id = $2`,
        [newRevision.id, data.duplicateFromId],
      );
    }

    // Explicitly provided parts are inserted (and override duplicated ones
    // for the same part via upsert).
    await insertRevisionParts(client, newRevision.id, data.parts);

    // Carry-forward (document-system-plan.md §3.4): inherit the source
    // revision's documents — or, with no explicit source, the previous
    // revision's — by reference. Only rows are copied; the files themselves
    // stay stored once and are shared between the two revisions.
    await carryForwardOnNewRevision(
      client,
      'subProduct',
      spId,
      newRevision.id,
      data.duplicateFromId,
      data.documentsFromId,
    );

    await client.query('COMMIT');
    res.json(newRevision);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PATCH /api/sub-products/:spId/revisions/:revId — update label, status, change_notes
router.patch('/:spId/revisions/:revId', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  const revId = Number(req.params.revId);
  if (!spId || !revId || Number.isNaN(spId) || Number.isNaN(revId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  }
  const data = revisionUpdateSchema.parse(req.body);

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
  values.push(spId, revId);

  try {
    const result = await query(
      `UPDATE sub_product_revisions
       SET ${fields.join(', ')}
       WHERE sub_product_id = $${i} AND id = $${i + 1}
       RETURNING id, sub_product_id AS "subProductId",
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

// DELETE /api/sub-products/:spId/revisions/:revId — delete a revision.
// Cascades remove its parts, documents and product-revision links.
router.delete('/:spId/revisions/:revId', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  const revId = Number(req.params.revId);
  if (!spId || !revId || Number.isNaN(spId) || Number.isNaN(revId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  }
  // Read the revision's firmware ids and folder identity first: the delete
  // cascades their rows away, and afterwards there is nothing left to derive
  // their folders from.
  const [firmwareContext, firmwares] = await Promise.all([
    findRevisionContext(pool, spId, revId),
    query<{ id: number }>(`SELECT id FROM firmwares WHERE sub_product_revision_id = $1`, [revId]),
  ]);

  const result = await query(
    `DELETE FROM sub_product_revisions
     WHERE id = $1 AND sub_product_id = $2
     RETURNING id`,
    [revId, spId],
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
  }

  if (firmwareContext?.product) {
    removeFirmwareDirs(
      firmwareContext.product,
      firmwareContext.subProduct,
      firmwares.rows.map((row) => row.id),
    );
  }

  res.json({ id: revId, deleted: true });
});

// PUT /api/sub-products/:spId/revisions/:revId/parts — replace the part set
router.put('/:spId/revisions/:revId/parts', requireAuth, async (req, res) => {
  const spId = Number(req.params.spId);
  const revId = Number(req.params.revId);
  if (!spId || !revId || Number.isNaN(spId) || Number.isNaN(revId)) {
    return res.status(400).json({ code: ErrorCodes.INVALID_REVISION_ID });
  }
  const data = replaceRevisionPartsSchema.parse(req.body);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const revCheck = await client.query(
      `SELECT id FROM sub_product_revisions WHERE id = $1 AND sub_product_id = $2`,
      [revId, spId],
    );
    if (revCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: ErrorCodes.REVISION_NOT_FOUND });
    }

    // Snapshot the current BOM (with part names) before the replace, so we can
    // diff old vs new for the product change log.
    const oldParts = await client.query<{
      partId: number;
      name: string;
      quantity: number | null;
      unit: string | null;
      notes: string | null;
      mountPosition: string | null;
    }>(
      `SELECT sprp.part_id AS "partId", p.name,
         sprp.quantity::integer AS quantity, sprp.unit, sprp.notes,
         sprp.mount_position AS "mountPosition"
       FROM sub_product_revision_parts sprp
       JOIN parts p ON p.id = sprp.part_id
       WHERE sprp.sub_product_revision_id = $1`,
      [revId],
    );

    await client.query(
      `DELETE FROM sub_product_revision_parts WHERE sub_product_revision_id = $1`,
      [revId],
    );
    await insertRevisionParts(client, revId, data.parts);

    // ── Product log: which BOM parts were added / changed / removed ──
    // Resolve the product plus the sub-product name and revision label so each
    // part event records *where* the change happened (which sub-product + rev).
    const prod = await client.query<{
      productId: number;
      subProductName: string;
      revLabel: string;
    }>(
      `SELECT sp.product_id AS "productId", sp.name AS "subProductName",
         spr.label AS "revLabel"
       FROM sub_products sp
       JOIN sub_product_revisions spr ON spr.id = $2
       WHERE sp.id = $1`,
      [spId, revId],
    );
    const productId = prod.rows[0]?.productId;
    const scope: AuditScope[] = prod.rows[0]
      ? [
          { type: 'sub_product', label: prod.rows[0].subProductName },
          { type: 'sub_product_revision', label: prod.rows[0].revLabel },
        ]
      : [];

    const incomingIds = data.parts.map((p) => p.partId);
    const nameRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM parts WHERE id = ANY($1::int[])`,
      [incomingIds.length ? incomingIds : [0]],
    );
    const nameById = new Map(nameRes.rows.map((r) => [r.id, r.name]));
    const oldByPart = new Map(oldParts.rows.map((r) => [r.partId, r]));
    const newIds = new Set(incomingIds);

    const events: AuditEvent[] = [];
    for (const p of data.parts) {
      const name = nameById.get(p.partId) ?? oldByPart.get(p.partId)?.name ?? String(p.partId);
      const to = bomLineDetails(
        p.quantity,
        p.unit || null,
        p.notes || null,
        p.mountPosition || null,
      );
      const prev = oldByPart.get(p.partId);
      if (!prev) {
        events.push({ type: 'part', tag: 'added', label: name, scope, to });
      } else if (
        !valuesEqual(prev.quantity, p.quantity) ||
        !valuesEqual(prev.unit, p.unit || null) ||
        !valuesEqual(prev.notes, p.notes || null) ||
        !valuesEqual(prev.mountPosition, p.mountPosition || null)
      ) {
        events.push({
          type: 'part',
          tag: 'changed',
          label: name,
          scope,
          from: bomLineDetails(
            prev.quantity,
            prev.unit,
            prev.notes,
            prev.mountPosition,
          ),
          to,
        });
      }
    }
    for (const o of oldParts.rows) {
      if (!newIds.has(o.partId)) {
        events.push({
          type: 'part',
          tag: 'removed',
          label: o.name,
          scope,
          from: bomLineDetails(o.quantity, o.unit, o.notes, o.mountPosition),
        });
      }
    }

    if (events.length > 0 && productId) {
      const actor = await resolveActor(client, req.user?.id);
      await logAudit(client, 'product', productId, 'updated', { events }, actor);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Return the fresh part list (same shape as the GET endpoint).
  const result = await query(
    `SELECT
       p.id, p.name, p.code, p.category_id AS "categoryId",
       p.price_per_piece AS "pricePerPiece", p.image,
       sprp.quantity::integer AS quantity, sprp.unit, sprp.notes,
       sprp.mount_position AS "mountPosition"
     FROM sub_product_revision_parts sprp
     JOIN parts p ON p.id = sprp.part_id
     WHERE sprp.sub_product_revision_id = $1
     ORDER BY p.name`,
    [revId],
  );
  res.json(result.rows);
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
       sprp.quantity::integer AS quantity,
       sprp.unit,
       sprp.notes,
       sprp.mount_position AS "mountPosition"
     FROM sub_product_revision_parts sprp
     JOIN parts p ON p.id = sprp.part_id
     WHERE sprp.sub_product_revision_id = $1
     ORDER BY p.name`,
    [revId],
  );
  res.json(result.rows);
});

export default router;
