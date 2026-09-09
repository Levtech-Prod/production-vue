import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { releaseStoredFile, unlinkStoredFile } from '../services/documentFiles.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import {
  revisionUpdateSchema,
  revisionUpdateAssignments,
} from '../schemas/revisions.schema.js';
import { setRevisionSubProductsSchema } from '../schemas/subProducts.schema.js';
import {
  writeAudit,
  changeSet,
  valuesEqual,
  type AuditEvent,
  type AuditScope,
} from '../services/audit.js';
import { parseId, requireId } from './routeParams.js';

const router = Router();

// One sub-product revision resolved with the fields the change log needs:
// its identity, its owning sub-product, and the display labels for both.
interface SubProductRevisionDetail {
  sprId: number;
  subProductId: number;
  subProductName: string;
  revLabel: string;
}

// GET /api/product-revisions/compare?a=&b= — structured diff (server-side).
// Registered before /:revId routes so the literal path takes precedence.
router.get('/compare', requireAuth, async (req, res) => {
  const a = parseId(req.query.a);
  const b = parseId(req.query.b);
  if (!a || !b) throw new ApiError(400, ErrorCodes.COMPARE_INVALID_PARAMS);

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
    { subProductId: number; name: string; sku: string | null; inA: Side; inB: Side }
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

// GET /api/product-revisions/:revId/bom — aggregated parts for all sub-products in a revision
router.get('/:revId/bom', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);

  const result = await query(
    `SELECT
       sp.id          AS "subProductId",
       sp.name        AS "subProductName",
       sp.sku         AS "subProductSku",
       sp.image       AS "subProductImage",
       spr.id         AS "subProductRevisionId",
       spr.label      AS "subProductRevisionLabel",
       p.id           AS "partId",
       p.name         AS "partName",
       p.code         AS "partCode",
       p.image        AS "partImage",
       sprp.quantity,
       sprp.unit,
       sprp.notes,
       sprp.mount_position AS "mountPosition"
     FROM product_revision_sub_products prsp
     JOIN sub_product_revisions spr ON spr.id = prsp.sub_product_revision_id
     JOIN sub_products sp ON sp.id = spr.sub_product_id
     LEFT JOIN sub_product_revision_parts sprp ON sprp.sub_product_revision_id = spr.id
     LEFT JOIN parts p ON p.id = sprp.part_id
     WHERE prsp.product_revision_id = $1
     ORDER BY sp.name, p.name`,
    [revId],
  );

  // Group flat rows into sub-products with nested parts
  interface BomPart {
    id: number;
    name: string;
    code: string;
    image: string | null;
    quantity: number;
    unit: string | null;
    notes: string | null;
    mountPosition: string | null;
  }
  const map = new Map<number, {
    subProductId: number;
    subProductName: string;
    subProductSku: string | null;
    subProductImage: string | null;
    subProductRevisionId: number;
    subProductRevisionLabel: string;
    parts: BomPart[];
  }>();

  for (const row of result.rows) {
    if (!map.has(row.subProductId)) {
      map.set(row.subProductId, {
        subProductId: row.subProductId,
        subProductName: row.subProductName,
        subProductSku: row.subProductSku,
        subProductImage: row.subProductImage ?? null,
        subProductRevisionId: row.subProductRevisionId,
        subProductRevisionLabel: row.subProductRevisionLabel,
        parts: [],
      });
    }
    if (row.partId != null) {
      map.get(row.subProductId)!.parts.push({
        id: row.partId,
        name: row.partName,
        code: row.partCode,
        image: row.partImage ?? null,
        quantity: row.quantity,
        unit: row.unit ?? null,
        notes: row.notes ?? null,
        mountPosition: row.mountPosition ?? null,
      });
    }
  }

  res.json(Array.from(map.values()));
});

// Every alternative link across the whole BOM in one query — the flattened
// product view opens every sub-product at once, so per-sub-product fetching
// would be N requests per page load.
router.get('/:revId/part-alternatives', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);

  const result = await query<{
    id: number;
    subProductRevisionId: number;
    partId: number;
    alternatePartId: number;
    alternateInUse: boolean;
  }>(
    `SELECT pa.id,
            pa.sub_product_revision_id AS "subProductRevisionId",
            pa.part_id AS "partId",
            pa.alternate_part_id AS "alternatePartId",
            pa.alternate_in_use AS "alternateInUse"
     FROM part_alternatives pa
     JOIN product_revision_sub_products prsp
       ON prsp.sub_product_revision_id = pa.sub_product_revision_id
     WHERE prsp.product_revision_id = $1
     ORDER BY pa.id`,
    [revId],
  );
  res.json(result.rows);
});

// PATCH /api/product-revisions/:revId — update status, change_notes, label
router.patch('/:revId', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const data = revisionUpdateSchema.parse(req.body);

  const { assignments, values } = revisionUpdateAssignments(data);
  if (assignments.length === 0) {
    throw new ApiError(400, ErrorCodes.REVISION_UPDATE_FAILED);
  }
  values.push(revId);

  const result = await query(
    `UPDATE product_revisions
     SET ${assignments.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, product_id AS "productId",
       revision_number AS "revisionNumber", label, status,
       change_notes AS "changeNotes", created_at AS "createdAt"`,
    values,
  );
  if (result.rowCount === 0) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);
  res.json(result.rows[0]);
});

// PATCH /api/product-revisions/:revId/sub-products — replace the linked set
router.patch('/:revId/sub-products', requireAuth, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);
  const data = setRevisionSubProductsSchema.parse(req.body);

  await withTransaction(async (client) => {
    const revInfo = await client.query<{ productId: number; label: string }>(
      `SELECT product_id AS "productId", label FROM product_revisions WHERE id = $1`,
      [revId],
    );
    if (revInfo.rowCount === 0) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);

    // Snapshot the current membership (keyed by sub-product, since a product
    // revision holds at most one revision per sub-product) so we can diff it
    // against the new set for the product change log.
    const oldMembers = await client.query<SubProductRevisionDetail>(
      `SELECT spr.sub_product_id AS "subProductId", sp.name AS "subProductName",
         prsp.sub_product_revision_id AS "sprId", spr.label AS "revLabel"
       FROM product_revision_sub_products prsp
       JOIN sub_product_revisions spr ON spr.id = prsp.sub_product_revision_id
       JOIN sub_products sp ON sp.id = spr.sub_product_id
       WHERE prsp.product_revision_id = $1`,
      [revId],
    );

    // Resolve the incoming revisions once — identity (for dedup) plus name and
    // label (for the change log) in a single fetch, reused for both below.
    //
    // Scoped to sub-products of THIS product: without it a crafted request
    // could build a revision from another product's sub-product, which the
    // detail page (which lists by `sp.product_id`) would then not show, and
    // whose files live under the other product's folder.
    const incomingIds = data.subProductRevisionIds;
    const detail = incomingIds.length
      ? await client.query<SubProductRevisionDetail>(
          `SELECT spr.id AS "sprId", spr.sub_product_id AS "subProductId",
             sp.name AS "subProductName", spr.label AS "revLabel"
           FROM sub_product_revisions spr
           JOIN sub_products sp ON sp.id = spr.sub_product_id
           WHERE spr.id = ANY($1::int[])
             AND sp.product_id = $2`,
          [incomingIds, revInfo.rows[0].productId],
        )
      : { rows: [] };
    const detailBySpr = new Map(detail.rows.map((r) => [r.sprId, r]));

    // A product revision may hold at most ONE revision per sub-product.
    // Deduplicate the incoming list (last entry per sub-product wins), dropping
    // unknown revision ids. Keyed by sub-product, so it doubles as the "new"
    // side of the change-log diff below.
    const newBySp = new Map<number, SubProductRevisionDetail>();
    for (const sprId of incomingIds) {
      const d = detailBySpr.get(sprId);
      if (!d) continue; // unknown, or not this product's — drop it
      newBySp.set(d.subProductId, d);
    }
    const cleanIds = Array.from(newBySp.values()).map((d) => d.sprId);

    await client.query(
      `DELETE FROM product_revision_sub_products WHERE product_revision_id = $1`,
      [revId],
    );

    // Re-insert the deduplicated set in one round-trip; ORDINALITY restores the
    // 0-based position from the array order.
    if (cleanIds.length > 0) {
      await client.query(
        `INSERT INTO product_revision_sub_products
           (product_revision_id, sub_product_revision_id, position)
         SELECT $1, sprid, ord - 1
         FROM unnest($2::int[]) WITH ORDINALITY AS t(sprid, ord)`,
        [revId, cleanIds],
      );
    }

    // ── Product log: which sub-products were added / changed / removed for
    // this product revision. Each event records the product revision as scope.
    const oldBySp = new Map(oldMembers.rows.map((r) => [r.subProductId, r]));
    const scope: AuditScope[] = [
      { type: 'product_revision', label: revInfo.rows[0].label },
    ];

    const events: AuditEvent[] = [];
    for (const [spId, n] of newBySp) {
      const prev = oldBySp.get(spId);
      if (!prev) {
        events.push({
          type: 'sub_product',
          tag: 'added',
          label: n.subProductName,
          scope,
          to: n.revLabel,
        });
      } else if (!valuesEqual(prev.sprId, n.sprId)) {
        events.push({
          type: 'sub_product',
          tag: 'changed',
          label: n.subProductName,
          scope,
          from: prev.revLabel,
          to: n.revLabel,
        });
      }
    }
    for (const [spId, o] of oldBySp) {
      if (!newBySp.has(spId)) {
        events.push({
          type: 'sub_product',
          tag: 'removed',
          label: o.subProductName,
          scope,
          from: o.revLabel,
        });
      }
    }

    await writeAudit(
      client,
      'product',
      revInfo.rows[0].productId,
      'updated',
      changeSet({}, events),
      req.user?.id,
    );
  });

  // Read back after the commit: this is a plain read of the set just written,
  // and inside the transaction it sat past COMMIT under a catch that would
  // have rolled back an already-finished transaction.
  const result = await query(
    `SELECT sub_product_revision_id AS "subProductRevisionId", position
     FROM product_revision_sub_products
     WHERE product_revision_id = $1
     ORDER BY position`,
    [revId],
  );
  res.json(result.rows);
});

// DELETE /api/product-revisions/:revId — remove a product revision entirely.
// Admin-only: this drops the revision's composition and its document rows for
// good. Two states a product must never be left in are refused up front: no
// default revision, and no revisions at all.
router.delete('/:revId', requireAuth, requireAdmin, async (req, res) => {
  const revId = requireId(req.params.revId, ErrorCodes.INVALID_REVISION_ID);

  const orphanKeys = await withTransaction(async (client) => {
    // Guards read inside the transaction, so a concurrent "set as default"
    // can't slip between the check and the delete.
    const info = await client.query<{
      productId: number;
      label: string;
      isDefault: boolean;
    }>(
      `SELECT pr.product_id AS "productId", pr.label,
         (p.default_revision_id IS NOT DISTINCT FROM pr.id) AS "isDefault"
       FROM product_revisions pr
       JOIN products p ON p.id = pr.product_id
       WHERE pr.id = $1
       FOR UPDATE OF pr`,
      [revId],
    );
    const revision = info.rows[0];
    if (!revision) throw new ApiError(404, ErrorCodes.REVISION_NOT_FOUND);
    if (revision.isDefault) throw new ApiError(409, ErrorCodes.REVISION_IS_DEFAULT);

    const siblings = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM product_revisions WHERE product_id = $1`,
      [revision.productId],
    );
    if ((siblings.rows[0]?.count ?? 0) <= 1) {
      throw new ApiError(409, ErrorCodes.REVISION_LAST_REMAINING);
    }

    // A project pins the revision it builds (§3.2), and `project_products`
    // references it without an ON DELETE — including from a draft, whose
    // product set was chosen before anything was frozen.
    const pinned = await client.query<{ pinned: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM project_products WHERE product_revision_id = $1) AS pinned`,
      [revId],
    );
    if (pinned.rows[0].pinned) {
      throw new ApiError(409, ErrorCodes.REVISION_IN_USE_BY_PROJECT);
    }

    // Read the document rows' files before the cascade takes them away.
    const files = await client.query<{ storedFileId: number }>(
      `SELECT DISTINCT stored_file_id AS "storedFileId"
       FROM product_revision_documents
       WHERE product_revision_id = $1`,
      [revId],
    );

    // Cascades (see schema.sql) remove the sub-product links and the document
    // rows; the physical files are shared with other revisions, so they are
    // released one by one below rather than deleted with them.
    await client.query(`DELETE FROM product_revisions WHERE id = $1`, [revId]);

    const keys: string[] = [];
    for (const row of files.rows) {
      const key = await releaseStoredFile(client, row.storedFileId);
      if (key) keys.push(key);
    }

    await writeAudit(
      client,
      'product',
      revision.productId,
      'updated',
      { events: [{ type: 'revision', tag: 'removed', label: revision.label }] },
      req.user?.id,
    );

    return keys;
  });

  // Post-commit: an unlink cannot be rolled back.
  for (const key of orphanKeys) unlinkStoredFile(key);

  res.json({ id: revId, deleted: true });
});

export default router;
