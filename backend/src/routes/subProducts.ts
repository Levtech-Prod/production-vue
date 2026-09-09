import { Router } from 'express';
import type { PoolClient } from 'pg';
import {
  query,
  pool,
  withTransaction,
  isUniqueViolation,
  isForeignKeyViolation,
} from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  createSubProductSchema,
  subProductPayloadSchema,
  newSubProductRevisionSchema,
  replaceRevisionPartsSchema,
  createPartAlternativeSchema,
  setPartAlternativeInUseSchema,
} from '../schemas/subProducts.schema.js';
import {
  revisionUpdateSchema,
  revisionUpdateAssignments,
} from '../schemas/revisions.schema.js';
import {
  writeAudit,
  changeSet,
  valuesEqual,
  type AuditEvent,
  type AuditScope,
} from '../services/audit.js';
import {
  carryForwardOnNewRevision,
  removeEntityFolder,
  type Queryable,
} from '../services/documentFiles.js';
import { fileEntityImage, removeImageFile } from '../services/entityImages.js';
import type { FolderEntity } from '../services/uploadPaths.js';
import { parseId, requireId } from './routeParams.js';

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

/** The owning product, or the 404 its absence means — a sub-product's folder
 *  lives inside its product's, so nothing can be filed without it. */
async function requireFolderProduct(
  db: Queryable,
  productId: number,
): Promise<FolderEntity> {
  const parent = await findFolderProduct(db, productId);
  if (!parent) throw new ApiError(404, ErrorCodes.PRODUCT_NOT_FOUND);
  return parent;
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

/** Where a sub-product-revision change happened, and whose log it belongs on.
 *  `productId` is nullable: a sub-product with no product has no product log
 *  to write to. */
interface RevisionContext {
  subProductName: string;
  productId: number | null;
  revLabel: string;
}

/** `subProductId` scopes the lookup to one sub-product, which is also how the
 *  write endpoints check that the revision is the one the URL claims. */
async function loadRevisionContext(
  db: Queryable,
  revId: number,
  subProductId?: number,
): Promise<RevisionContext | null> {
  const result = await db.query<RevisionContext>(
    `SELECT sp.name AS "subProductName", sp.product_id AS "productId",
       spr.label AS "revLabel"
     FROM sub_product_revisions spr
     JOIN sub_products sp ON sp.id = spr.sub_product_id
     WHERE spr.id = $1 AND ($2::int IS NULL OR spr.sub_product_id = $2)`,
    [revId, subProductId ?? null],
  );
  return result.rows[0] ?? null;
}

/** One part-alternative change on the owning product's log, located at the
 *  sub-product and revision it happened in — the shape all three alternative
 *  endpoints write, and the reason none of them spells the scope itself. */
async function logAlternativeChange(
  client: PoolClient,
  context: RevisionContext,
  event: Pick<AuditEvent, 'tag' | 'label' | 'from' | 'to'>,
  userId: number | undefined,
): Promise<void> {
  if (!context.productId) return;
  await writeAudit(client, 'product', context.productId, 'updated', {
    events: [
      {
        type: 'part_alternative',
        scope: [
          { type: 'sub_product', label: context.subProductName },
          { type: 'sub_product_revision', label: context.revLabel },
        ],
        ...event,
      },
    ],
  }, userId);
}

/** Part names by id, for the audit labels that would otherwise say a number. */
async function partNames(db: Queryable, ids: number[]): Promise<Map<number, string>> {
  const result = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM parts WHERE id = ANY($1::int[])`,
    [ids.length ? ids : [0]],
  );
  return new Map(result.rows.map((r) => [r.id, r.name]));
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
  const a = parseId(req.query.a);
  const b = parseId(req.query.b);
  if (!a || !b) throw new ApiError(400, ErrorCodes.COMPARE_INVALID_PARAMS);

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
       sprp.quantity,
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
        (e.inA.mountPosition ?? '') !== (e.inB.mountPosition ?? '') ||
        (e.inA.notes ?? '') !== (e.inB.notes ?? ''))
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
  let filedImage: string | null = null;
  try {
    const created = await withTransaction(async (client) => {
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
      const parent = await requireFolderProduct(client, data.productId);
      filedImage = await fileEntityImage(client, 'sub_products', subProduct, parent);

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
      await writeAudit(client, 'product', data.productId, 'updated', {
        events: [{ type: 'sub_product', tag: 'added', label: subProduct.name }],
      }, req.user?.id);

      return { ...subProduct, revisions: [rev1] };
    });

    res.json(created);
  } catch (err) {
    removeImageFile(filedImage);
    if (isUniqueViolation(err)) {
      throw new ApiError(409, ErrorCodes.SUB_PRODUCT_SKU_ALREADY_EXISTS);
    }
    // `type` must reference an existing sub_product_types.name (see schema.sql).
    if (isForeignKeyViolation(err)) {
      throw new ApiError(422, ErrorCodes.INVALID_SUB_PRODUCT_TYPE);
    }
    throw err;
  }
});

// PATCH /api/sub-products/:spId — update sub-product fields (admin only)
router.patch('/:spId', requireAuth, requireAdmin, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_SUB_PRODUCT_ID);
  const data = subProductPayloadSchema.parse(req.body);
  let filedImage: string | null = null;

  try {
    const updated = await withTransaction(async (client) => {
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
      if (result.rowCount === 0) throw new ApiError(404, ErrorCodes.SUB_PRODUCT_NOT_FOUND);

      const row = result.rows[0];
      const parent = await requireFolderProduct(client, row.productId);
      filedImage = await fileEntityImage(client, 'sub_products', row, parent);

      const { oldImage, productId: _pid, ...subProductOut } = row;
      return { subProductOut, replaced: valuesEqual(oldImage, row.image) ? null : oldImage };
    });

    // Post-commit: an unlink cannot be rolled back, so the replaced file only
    // goes once the new one is durably recorded.
    removeImageFile(updated.replaced);
    res.json(updated.subProductOut);
  } catch (err) {
    removeImageFile(filedImage);
    if (isUniqueViolation(err)) {
      throw new ApiError(409, ErrorCodes.SUB_PRODUCT_SKU_ALREADY_EXISTS);
    }
    // `type` must reference an existing sub_product_types.name (see schema.sql).
    if (isForeignKeyViolation(err)) {
      throw new ApiError(422, ErrorCodes.INVALID_SUB_PRODUCT_TYPE);
    }
    throw err;
  }
});

// DELETE /api/sub-products/:spId — delete a whole sub-product.
// Cascades (see schema.sql FKs) remove its revisions, their parts,
// documents, and any product-revision membership links.
router.delete('/:spId', requireAuth, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_SUB_PRODUCT_ID);
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
  if (!subProduct) throw new ApiError(404, ErrorCodes.SUB_PRODUCT_NOT_FOUND);

  // Deleting a sub-product cascades to its revisions, and a revision a started
  // project froze is the one thing that will not go: `project_part_usages`
  // references it without an ON DELETE. Refused here, since the cascade would
  // otherwise fail as a 23503 naming nothing.
  const claimed = await query<{ claimed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM project_part_usages ppu
       JOIN sub_product_revisions spr ON spr.id = ppu.sub_product_revision_id
       WHERE spr.sub_product_id = $1) AS claimed`,
    [spId],
  );
  if (claimed.rows[0].claimed) {
    throw new ApiError(409, ErrorCodes.SUB_PRODUCT_IN_USE_BY_PROJECT);
  }

  const parent =
    subProduct.productId === null ? null : await findFolderProduct(pool, subProduct.productId);

  const result = await query(
    `DELETE FROM sub_products WHERE id = $1 RETURNING id`,
    [spId],
  );
  if (result.rowCount === 0) throw new ApiError(404, ErrorCodes.SUB_PRODUCT_NOT_FOUND);

  // Post-delete: the cascade has removed every row pointing into this folder,
  // so the whole thing goes. Previously these files were left behind on disk.
  // Document-type versions sit inside this folder too
  // (`documents/revisions/`), so they go with it — no separate sweep needed.
  if (parent) removeEntityFolder({ ...subProduct, product: parent });

  res.json({ id: spId, deleted: true });
});

// POST /api/sub-products/:spId/revisions — new revision (parts + optional duplicate)
router.post('/:spId/revisions', requireAuth, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_SUB_PRODUCT_ID);
  const data = newSubProductRevisionSchema.parse(req.body);

  const newRevision = await withTransaction(async (client) => {
    const spExists = await client.query(
      `SELECT id FROM sub_products WHERE id = $1`,
      [spId],
    );
    if (spExists.rowCount === 0) throw new ApiError(404, ErrorCodes.SUB_PRODUCT_NOT_FOUND);

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
    const revision = newRevResult.rows[0];

    // Copy parts from a source revision when duplicating.
    if (data.duplicateFromId) {
      await client.query(
        `INSERT INTO sub_product_revision_parts
           (sub_product_revision_id, part_id, quantity, unit, notes, mount_position)
         SELECT $1, part_id, quantity, unit, notes, mount_position
         FROM sub_product_revision_parts
         WHERE sub_product_revision_id = $2`,
        [revision.id, data.duplicateFromId],
      );

      // Alternative-part links (see migration 021) are per-revision too —
      // carry them forward the same way, so the new revision starts with the
      // same links and can then diverge independently.
      await client.query(
        `INSERT INTO part_alternatives
           (sub_product_revision_id, part_id, alternate_part_id, created_by)
         SELECT $1, part_id, alternate_part_id, created_by
         FROM part_alternatives
         WHERE sub_product_revision_id = $2`,
        [revision.id, data.duplicateFromId],
      );
    }

    // Explicitly provided parts are inserted (and override duplicated ones
    // for the same part via upsert).
    await insertRevisionParts(client, revision.id, data.parts);

    // Carry-forward (document-system-plan.md §3.4): inherit the source
    // revision's documents — or, with no explicit source, the previous
    // revision's — by reference. Only rows are copied; the files themselves
    // stay stored once and are shared between the two revisions.
    await carryForwardOnNewRevision(
      client,
      'subProduct',
      spId,
      revision.id,
      data.duplicateFromId,
      data.documentsFromId,
    );

    return revision;
  });

  res.json(newRevision);
});

// PATCH /api/sub-products/:spId/revisions/:revId — update label, status, change_notes
router.patch('/:spId/revisions/:revId', requireAuth, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_REVISION_ID);
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const data = revisionUpdateSchema.parse(req.body);

  const { assignments, values } = revisionUpdateAssignments(data);
  if (assignments.length === 0) {
    throw new ApiError(400, ErrorCodes.REVISION_UPDATE_FAILED);
  }
  values.push(spId, revId);

  const result = await query(
    `UPDATE sub_product_revisions
     SET ${assignments.join(', ')}
     WHERE sub_product_id = $${values.length - 1} AND id = $${values.length}
     RETURNING id, sub_product_id AS "subProductId",
       revision_number AS "revisionNumber", label, status,
       change_notes AS "changeNotes", created_at AS "createdAt"`,
    values,
  );
  if (result.rowCount === 0) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);
  res.json(result.rows[0]);
});

// DELETE /api/sub-products/:spId/revisions/:revId — delete a revision.
// Cascades remove its parts, documents and product-revision links.
router.delete('/:spId/revisions/:revId', requireAuth, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_REVISION_ID);
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);

  // A project that froze this revision's parts still points at it (§3.4).
  const claimed = await query<{ claimed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM project_part_usages WHERE sub_product_revision_id = $1) AS claimed`,
    [revId],
  );
  if (claimed.rows[0].claimed) {
    throw new ApiError(409, ErrorCodes.REVISION_IN_USE_BY_PROJECT);
  }

  const result = await query(
    `DELETE FROM sub_product_revisions
     WHERE id = $1 AND sub_product_id = $2
     RETURNING id`,
    [revId, spId],
  );
  if (result.rowCount === 0) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);

  res.json({ id: revId, deleted: true });
});

// PUT /api/sub-products/:spId/revisions/:revId/parts — replace the part set
router.put('/:spId/revisions/:revId/parts', requireAuth, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_REVISION_ID);
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const data = replaceRevisionPartsSchema.parse(req.body);

  await withTransaction(async (client) => {
    const revCheck = await client.query(
      `SELECT id FROM sub_product_revisions WHERE id = $1 AND sub_product_id = $2`,
      [revId, spId],
    );
    if (revCheck.rowCount === 0) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);

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
         sprp.quantity, sprp.unit, sprp.notes,
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
    const nameById = await partNames(client, incomingIds);
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

    if (productId) {
      await writeAudit(client, 'product', productId, 'updated', changeSet({}, events), req.user?.id);
    }
  });

  // Return the fresh part list (same shape as the GET endpoint).
  const result = await query(
    `SELECT
       p.id, p.name, p.code, p.category_id AS "categoryId",
       p.price_per_piece AS "pricePerPiece", p.image,
       sprp.quantity, sprp.unit, sprp.notes,
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
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
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

// Ids only: the frontend holds the parts catalog and resolves the rest.
router.get('/:spId/revisions/:revId/part-alternatives', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const result = await query<{
    id: number;
    partId: number;
    alternatePartId: number;
    alternateInUse: boolean;
  }>(
    `SELECT id,
            part_id AS "partId",
            alternate_part_id AS "alternatePartId",
            alternate_in_use AS "alternateInUse"
     FROM part_alternatives
     WHERE sub_product_revision_id = $1
     ORDER BY id`,
    [revId],
  );
  res.json(result.rows);
});

// SET this part's alternative — a part carries at most one, so posting a
// different one DROPS the existing link rather than adding to a list.
router.post('/:spId/revisions/:revId/part-alternatives', requireAuth, async (req, res) => {
  const spId = requireId(req.params.spId, ErrorCodes.INVALID_REVISION_ID);
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const data = createPartAlternativeSchema.parse(req.body);
  if (data.partId === data.alternatePartId) {
    throw new ApiError(400, ErrorCodes.PART_ALTERNATIVE_SAME_PART);
  }

  const link = await withTransaction(async (client) => {
    const context = await loadRevisionContext(client, revId, spId);
    if (!context) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);

    const nameById = await partNames(client, [data.partId, data.alternatePartId]);
    if (nameById.size !== 2) throw new ApiError(404, ErrorCodes.PART_NOT_FOUND);

    // Read before the delete; name joined so the audit can say what it replaced.
    const previous = await client.query<{
      id: number;
      alternatePartId: number;
      alternatePartName: string;
      alternateInUse: boolean;
    }>(
      `SELECT pa.id,
              pa.alternate_part_id AS "alternatePartId",
              pa.alternate_in_use AS "alternateInUse",
              p.name AS "alternatePartName"
       FROM part_alternatives pa
       JOIN parts p ON p.id = pa.alternate_part_id
       WHERE pa.sub_product_revision_id = $1 AND pa.part_id = $2`,
      [revId, data.partId],
    );
    const before = previous.rows[0];

    // Already set: skip the write so the log doesn't gain a no-op entry.
    if (before?.alternatePartId === data.alternatePartId) {
      return {
        id: before.id,
        partId: data.partId,
        alternatePartId: data.alternatePartId,
        alternateInUse: before.alternateInUse,
      };
    }

    if (before) {
      await client.query(`DELETE FROM part_alternatives WHERE id = $1`, [before.id]);
    }

    // New links are fitted on creation; swaps keep the existing flag, so
    // changing the standby doesn't silently substitute it.
    const inUse = before?.alternateInUse ?? true;

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO part_alternatives
         (sub_product_revision_id, part_id, alternate_part_id, alternate_in_use, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [revId, data.partId, data.alternatePartId, inUse, req.user?.id ?? null],
    );

    await logAlternativeChange(
      client,
      context,
      {
        tag: before ? 'changed' : 'added',
        label: nameById.get(data.partId),
        from: before ? before.alternatePartName : null,
        to: nameById.get(data.alternatePartId),
      },
      req.user?.id,
    );

    return {
      id: inserted.rows[0].id,
      partId: data.partId,
      alternatePartId: data.alternatePartId,
      alternateInUse: inUse,
    };
  });

  res.json(link);
});

// Switch which half of the pair is fitted. Its own route rather than a POST
// field, so it reads as its own line in the change log.
router.patch('/:spId/revisions/:revId/part-alternatives/:id', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const id = requireId(req.params.id, ErrorCodes.INVALID_REVISION_ID);
  const data = setPartAlternativeInUseSchema.parse(req.body);

  const link = await withTransaction(async (client) => {
    const updated = await client.query<{
      partId: number;
      alternatePartId: number;
      partName: string;
      alternatePartName: string;
    }>(
      `UPDATE part_alternatives pa
       SET alternate_in_use = $1
       FROM parts p, parts ap
       WHERE pa.id = $2
         AND pa.sub_product_revision_id = $3
         AND p.id = pa.part_id
         AND ap.id = pa.alternate_part_id
       RETURNING pa.part_id AS "partId",
                 pa.alternate_part_id AS "alternatePartId",
                 p.name AS "partName",
                 ap.name AS "alternatePartName"`,
      [data.alternateInUse, id, revId],
    );
    if (updated.rowCount === 0) {
      throw new ApiError(404, ErrorCodes.PART_ALTERNATIVE_NOT_FOUND);
    }
    const row = updated.rows[0];

    const context = await loadRevisionContext(client, revId);
    if (context) {
      await logAlternativeChange(
        client,
        context,
        {
          tag: 'changed',
          label: row.partName,
          // Named parts, not a boolean, so the log names what is fitted.
          from: data.alternateInUse ? row.partName : row.alternatePartName,
          to: data.alternateInUse ? row.alternatePartName : row.partName,
        },
        req.user?.id,
      );
    }

    return {
      id,
      partId: row.partId,
      alternatePartId: row.alternatePartId,
      alternateInUse: data.alternateInUse,
    };
  });

  res.json(link);
});

// DELETE /api/sub-products/:spId/revisions/:revId/part-alternatives/:id — unlink.
router.delete('/:spId/revisions/:revId/part-alternatives/:id', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const id = requireId(req.params.id, ErrorCodes.INVALID_REVISION_ID);

  await withTransaction(async (client) => {
    const existing = await client.query<{ partId: number; alternatePartId: number }>(
      `DELETE FROM part_alternatives
       WHERE id = $1 AND sub_product_revision_id = $2
       RETURNING part_id AS "partId", alternate_part_id AS "alternatePartId"`,
      [id, revId],
    );
    if (existing.rowCount === 0) {
      throw new ApiError(404, ErrorCodes.PART_ALTERNATIVE_NOT_FOUND);
    }
    const { partId, alternatePartId } = existing.rows[0];

    const context = await loadRevisionContext(client, revId);
    if (context?.productId) {
      const nameById = await partNames(client, [partId, alternatePartId]);
      await logAlternativeChange(
        client,
        context,
        {
          tag: 'removed',
          label: nameById.get(partId) ?? String(partId),
          from: nameById.get(alternatePartId) ?? String(alternatePartId),
        },
        req.user?.id,
      );
    }
  });

  res.json({ id, deleted: true });
});

export default router;
