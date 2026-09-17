// Projects — CRUD, Start/Stop and the Parts table
// (projects-preparation-plan.md §5.2). The offer and order endpoints are
// separate stories; this file owns `projects`, the product set pinned to it
// (`project_products`), the read of its parts list — computed or frozen —
// and the two transitions that turn one into the other.
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { query, pool, withTransaction, type Queryable } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import { requireId } from './routeParams.js';
import {
  lockProject,
  lockProjectForPartsWrite,
  requireStartedForPartsWrite,
} from './projectAccess.js';
import {
  projectPayloadSchema,
  projectListQuerySchema,
  projectPartUpdateSchema,
  projectPartPicksSchema,
  projectSubProductRefSchema,
  type ProjectPartUpdateInput,
  type ProjectProductInput,
  type ProjectStatus,
} from '../schemas/projects.schema.js';
import {
  writeAudit,
  changeSet,
  diffFields,
  diffKeyedEvents,
  type AuditEvent,
  type KeyedValue,
} from '../services/audit.js';
import {
  computeProjectBom,
  freezeProjectBom,
  loadProjectPartsPayload,
  loadFrozenProjectBom,
  pruneDraftPartQuantities,
  resolveDraftPartQuantity,
  toProjectPartRows,
  resolveProjectPartUpdate,
  reseedFromStock,
  type ProjectPartRow,
} from '../services/projectBom.js';
import { buildProjectPartQtyEvents } from './projectPartAudit.js';
import {
  applySubProductPicks,
  loadSubProductParts,
  markSubProductPrepared,
  unmarkSubProductPrepared,
  type SubProductPreparationLabels,
} from '../services/projectPreparation.js';
import { loadBoardCard, loadBoardCards } from '../services/projectBoard.js';

const router = Router();

interface ProductRevisionInfo {
  productId: number;
  productName: string;
  productStatus: string;
  revisionLabel: string;
}

/** Resolve each revision id to the product it actually belongs to (plus the
 *  names an audit event needs), in one round trip. */
async function fetchRevisionInfo(
  db: Queryable,
  revisionIds: number[],
): Promise<Map<number, ProductRevisionInfo>> {
  if (revisionIds.length === 0) return new Map();
  const result = await db.query<{
    id: number;
    productId: number;
    productName: string;
    productStatus: string;
    revisionLabel: string;
  }>(
    `SELECT pr.id, pr.product_id AS "productId", p.name AS "productName",
       p.status AS "productStatus", pr.label AS "revisionLabel"
     FROM product_revisions pr
     JOIN products p ON p.id = pr.product_id
     WHERE pr.id = ANY($1::int[])`,
    [revisionIds],
  );
  return new Map(
    result.rows.map((r) => [
      r.id,
      {
        productId: r.productId,
        productName: r.productName,
        productStatus: r.productStatus,
        revisionLabel: r.revisionLabel,
      },
    ]),
  );
}

/** True when every product line's revision actually belongs to the product it
 *  claims — the friendly check in front of the composite FK (§3.2) that would
 *  otherwise surface as a raw constraint violation. Also catches a revision
 *  id that doesn't exist at all (absent from the map). */
function revisionsMatchProducts(
  products: ProjectProductInput[],
  infoByRevisionId: Map<number, ProductRevisionInfo>,
): boolean {
  return products.every(
    (p) => infoByRevisionId.get(p.productRevisionId)?.productId === p.productId,
  );
}

/** True when any pinned product is archived. The picker already hides them,
 *  but decision 1 rests on the pinned BOM being trustworthy, so the rule
 *  belongs on this side of the boundary too. A product archived *after* a
 *  draft pinned it keeps that line — this only guards what a write sends. */
function hasArchivedProduct(
  products: ProjectProductInput[],
  infoByRevisionId: Map<number, ProductRevisionInfo>,
): boolean {
  return products.some(
    (p) => infoByRevisionId.get(p.productRevisionId)?.productStatus === 'archived',
  );
}

/** True when the same revision was pinned twice in one payload. Left
 *  unchecked, this hits `project_products`' UNIQUE (project_id,
 *  product_revision_id) constraint and surfaces as a raw 500 instead of a
 *  clean 4xx — a plausible slip from a picker that lets the same product be
 *  added twice (pinning the same product at two different revisions is
 *  fine and stays allowed; only the same revision twice is a duplicate). */
function hasDuplicateRevisions(products: ProjectProductInput[]): boolean {
  const seen = new Set<number>();
  for (const p of products) {
    if (seen.has(p.productRevisionId)) return true;
    seen.add(p.productRevisionId);
  }
  return false;
}

/**
 * Everything a write must know about the product set before it touches the
 * database: that it is not empty, that no revision is pinned twice, that each
 * revision belongs to the product it was added under, and that none of the
 * products is archived. Answers with the revision info the caller then needs
 * for its audit labels, so the lookup is not repeated.
 *
 * Create and update run exactly these four checks in this order; splitting
 * them apart is how one of the two would eventually lose one.
 */
async function validateProductSet(
  products: ProjectProductInput[],
): Promise<Map<number, ProductRevisionInfo>> {
  if (products.length === 0) throw new ApiError(422, ErrorCodes.PROJECT_HAS_NO_PRODUCTS);
  if (hasDuplicateRevisions(products)) {
    throw new ApiError(422, ErrorCodes.PRODUCT_REVISION_DUPLICATE);
  }

  const revisionInfo = await fetchRevisionInfo(
    pool,
    products.map((p) => p.productRevisionId),
  );
  if (!revisionsMatchProducts(products, revisionInfo)) {
    throw new ApiError(422, ErrorCodes.PRODUCT_REVISION_MISMATCH);
  }
  if (hasArchivedProduct(products, revisionInfo)) {
    throw new ApiError(422, ErrorCodes.PRODUCT_ARCHIVED);
  }
  return revisionInfo;
}

/** Bulk-insert the pinned product set in one round trip, position taken from
 *  array order. */
async function insertProjectProducts(
  client: PoolClient,
  projectId: number,
  products: ProjectProductInput[],
): Promise<void> {
  if (products.length === 0) return;
  await client.query(
    `INSERT INTO project_products (project_id, product_id, product_revision_id, quantity, position)
     SELECT $1, product_id, product_revision_id, quantity, ord - 1
     FROM unnest($2::int[], $3::int[], $4::int[]) WITH ORDINALITY
       AS t(product_id, product_revision_id, quantity, ord)`,
    [
      projectId,
      products.map((p) => p.productId),
      products.map((p) => p.productRevisionId),
      products.map((p) => p.quantity),
    ],
  );
}

interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  deadline: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

interface ProjectProductRow {
  id: number;
  productId: number;
  name: string;
  sku: string;
  productRevisionId: number;
  revisionLabel: string;
  quantity: number;
  position: number;
}

/** Project + its pinned products (§5.2 `GET /:id`) — also the create/update
 *  response, so all three endpoints agree on one shape. */
async function loadProject(
  db: Queryable,
  projectId: number,
): Promise<(ProjectRow & { products: ProjectProductRow[] }) | null> {
  const projectResult = await db.query<ProjectRow>(
    `SELECT id, name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline, status,
       created_at AS "createdAt", updated_at AS "updatedAt",
       started_at AS "startedAt", stopped_at AS "stoppedAt"
     FROM projects WHERE id = $1`,
    [projectId],
  );
  const project = projectResult.rows[0];
  if (!project) return null;

  const productsResult = await db.query<ProjectProductRow>(
    `SELECT pp.id, pp.product_id AS "productId", p.name, p.sku,
       pp.product_revision_id AS "productRevisionId", pr.label AS "revisionLabel",
       pp.quantity, pp.position
     FROM project_products pp
     JOIN products p ON p.id = pp.product_id
     JOIN product_revisions pr ON pr.id = pp.product_revision_id
     WHERE pp.project_id = $1
     ORDER BY pp.position, pp.id`,
    [projectId],
  );

  return { ...project, products: productsResult.rows };
}

/** Keyed by revision id — the same product pinned to a different revision
 *  reads as remove-old/add-new, which is what actually happened to the
 *  pinned set. */
function productsToKeyed(
  products: { productRevisionId: number; name: string; revisionLabel: string; quantity: number }[],
): KeyedValue[] {
  return products.map((p) => ({
    key: p.productRevisionId,
    label: `${p.name} (${p.revisionLabel})`,
    value: String(p.quantity),
  }));
}

// GET /api/projects — board payload (§4.1). The query, the sub-product read
// and the column-membership rule all live in `services/projectBoard.ts`, since
// every write that can move a project between columns now answers with the one
// card it changed and has to derive membership exactly the same way.
// `?status=` is repeatable (defaults to draft+started, see §6.3); `?q=`
// searches the name.
router.get('/', requireAuth, async (req, res) => {
  const data = projectListQuerySchema.parse(req.query);
  res.json(await loadBoardCards(pool, { statuses: data.status, q: data.q ?? null }));
});

// POST /api/projects — create as `draft` with its pinned products.
router.post('/', requireAuth, async (req, res) => {
  const data = projectPayloadSchema.parse(req.body);
  await validateProductSet(data.products);

  const userId = req.user?.id;
  const result = await withTransaction(async (client) => {
    const projectResult = await client.query<{ id: number }>(
      `INSERT INTO projects (name, description, deadline, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [data.name, data.description || null, data.deadline || null, userId ?? null],
    );
    const projectId = projectResult.rows[0].id;

    await insertProjectProducts(client, projectId, data.products);
    await writeAudit(
      client,
      'project',
      projectId,
      'created',
      { snapshot: { name: data.name, productCount: data.products.length } },
      userId,
    );

    // The board card alongside the project: every mutation answers with the
    // one card it changed so the browser patches its board instead of
    // reloading it, and the membership rule stays where it was (decision 2).
    return {
      project: await loadProject(client, projectId),
      card: await loadBoardCard(client, projectId),
    };
  });

  res.json(result);
});

// GET /api/projects/:id — project + its pinned products.
router.get('/:id', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);

  const project = await loadProject(pool, projectId);
  if (!project) throw new ApiError(404, ErrorCodes.PROJECT_NOT_FOUND);
  res.json(project);
});

// GET /api/projects/:id/parts — the Parts table (§5.4). Works for a draft,
// whose rows are computed live from the pinned revisions so a project can be
// costed before it is committed to; a started one reads its frozen tables.
// Which of the two, and the one payload shape they share, is
// `services/projectBom.ts`'s to decide — this route only says whose.
router.get('/:id/parts', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);

  const projectResult = await query<{ status: ProjectStatus }>(
    `SELECT status FROM projects WHERE id = $1`,
    [projectId],
  );
  const project = projectResult.rows[0];
  if (!project) throw new ApiError(404, ErrorCodes.PROJECT_NOT_FOUND);

  res.json(await loadProjectPartsPayload(pool, projectId, project.status));
});

/**
 * The started half of the write below: the frozen `project_parts` row, edited
 * in place. Unchanged behaviour — it moved into a function when the draft half
 * arrived, so the route is the branch and nothing else.
 */
async function writeFrozenPartQuantity(
  client: PoolClient,
  projectId: number,
  partId: number,
  patch: ProjectPartUpdateInput,
  userId: number | undefined,
): Promise<ProjectPartRow> {
  const current = await client.query<{
    id: number;
    partName: string;
    fromStockQty: number;
    missingQty: number;
    orderedQty: number;
    receivedQty: number;
    preparedQty: number;
  }>(
    `SELECT pp.id, p.name AS "partName", pp.from_stock_qty AS "fromStockQty",
       pp.missing_qty AS "missingQty", pp.ordered_qty AS "orderedQty",
       pp.received_qty AS "receivedQty", pp.prepared_qty AS "preparedQty"
     FROM project_parts pp
     JOIN parts p ON p.id = pp.part_id
     WHERE pp.part_id = $1 AND pp.project_id = $2
     FOR UPDATE OF pp`,
    [partId, projectId],
  );
  const before = current.rows[0];
  if (!before) throw new ApiError(404, ErrorCodes.PROJECT_PART_NOT_FOUND);

  // Throws 409 MISSING_QTY_BELOW_ORDERED / FROM_STOCK_QTY_BELOW_PREPARED
  // rather than silently clamping: a line can never be made to owe less
  // than it has already bought, or claim less stock than has already been
  // picked from it, and the API is what actually enforces that, not just
  // the input's client-side clamp.
  const resolved = resolveProjectPartUpdate(before, patch);

  // Only a real change counts as "typing over a seeded value" (§3.3): a
  // PATCH that resolves to the same numbers already stored — the same
  // values re-sent, or one field edited while the other stays put — writes
  // nothing and leaves `missing_qty_overridden` exactly as it was, so an
  // inert save (e.g. a debounced field blurred without changing) can never
  // silently exempt this row from every future recalculate.
  const changed =
    resolved.fromStockQty !== before.fromStockQty || resolved.missingQty !== before.missingQty;

  if (changed) {
    // Both columns in one UPDATE (§3.3 "WRITE ORDER MATTERS"): the CHECKs
    // run per statement, so writing them one at a time could trip
    // `chk_project_parts_ordered_within_missing` on a row that is legal
    // once both writes have landed.
    await client.query(
      `UPDATE project_parts
       SET from_stock_qty = $1, missing_qty = $2, missing_qty_overridden = TRUE,
           updated_at = NOW()
       WHERE id = $3`,
      [resolved.fromStockQty, resolved.missingQty, before.id],
    );
    await writeProjectPartQtyAudit(client, projectId, before.partName, before, resolved, userId);
  }

  // Just this row, not the whole BOM: it is the only one that moved, and
  // reading the rest to throw it away is what made a single cell edit as
  // expensive as loading the table.
  const [updated] = toProjectPartRows(
    await loadFrozenProjectBom(client, projectId, [before.id]),
    'started',
  );
  if (!updated) throw new ApiError(404, ErrorCodes.PROJECT_PART_NOT_FOUND);
  return updated;
}

/**
 * The draft half (§12): the same number, stored in `project_draft_part_quantities`
 * because a draft has no `project_parts` row to put it in. Sparse — the row
 * exists only while the typed value differs from what the live seed computes,
 * so writing the seeded value back is what undoes an override.
 *
 * No re-read after the write. The upsert/delete is a single statement and its
 * value is the one this row now carries; the seed beside it is live either
 * way, exactly as `GET /:id/parts` serves it. Re-running the compute would
 * answer with the same two numbers for a second round trip per keystroke.
 */
async function writeDraftPartQuantity(
  client: PoolClient,
  projectId: number,
  partId: number,
  patch: ProjectPartUpdateInput,
  userId: number | undefined,
): Promise<ProjectPartRow> {
  // `from_stock_qty` is a column of the frozen BOM, and a draft has none —
  // which is exactly what PROJECT_PARTS_NOT_FROZEN says. A draft's claim on
  // stock is recomputed from free stock on every read, so there is nothing
  // here for a write to hold. The schema's refine guarantees at least one
  // field, so "no missingQty" is the fromStockQty-only patch, refused for the
  // same reason and with the same code.
  if (patch.missingQty === undefined || patch.fromStockQty !== undefined) {
    throw new ApiError(409, ErrorCodes.PROJECT_PARTS_NOT_FROZEN);
  }
  const missingQty = patch.missingQty;

  const [row] = await computeProjectBom(client, projectId, [partId]);
  // Not a part of this draft's BOM — including one whose product was
  // un-pinned since the table was loaded.
  if (!row) throw new ApiError(404, ErrorCodes.PROJECT_PART_NOT_FOUND);

  const resolved = resolveDraftPartQuantity(
    {
      requiredQty: row.requiredQty,
      free: row.stock.free,
      missingQty: row.missingQty,
      overridden: row.missingQtyOverridden,
    },
    missingQty,
  );

  if (resolved.action === 'delete') {
    await client.query(
      `DELETE FROM project_draft_part_quantities WHERE project_id = $1 AND part_id = $2`,
      [projectId, partId],
    );
  } else if (resolved.action === 'upsert') {
    await client.query(
      `INSERT INTO project_draft_part_quantities (project_id, part_id, missing_qty)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, part_id)
       DO UPDATE SET missing_qty = EXCLUDED.missing_qty, updated_at = NOW()`,
      [projectId, partId, missingQty],
    );
  }

  if (resolved.audit) {
    // §5.6: the same field, and the same dispute, as a started project's edit
    // — a quantity decided before Start is no less a purchasing decision, and
    // Start freezes it verbatim.
    await writeProjectPartQtyAudit(
      client,
      projectId,
      row.part.name,
      { fromStockQty: row.fromStockQty, missingQty: row.missingQty },
      { fromStockQty: row.fromStockQty, missingQty },
      userId,
    );
  }

  row.missingQty = resolved.missingQty;
  row.missingQtyOverridden = resolved.overridden;
  const [updated] = toProjectPartRows([row], 'draft');
  return updated;
}

/** One audit event for a part's sourcing quantities moving, from either half
 *  above (§5.6). */
async function writeProjectPartQtyAudit(
  client: PoolClient,
  projectId: number,
  partName: string,
  before: { fromStockQty: number; missingQty: number },
  after: { fromStockQty: number; missingQty: number },
  userId: number | undefined,
): Promise<void> {
  const events = buildProjectPartQtyEvents([{ partName, before, after }]);
  await writeAudit(client, 'project', projectId, 'updated', changeSet({}, events), userId);
}

// PATCH /api/projects/:id/parts/:partId/quantity — set what to BUY of one
// part (§5.2, §12). Keyed on `parts.id`, not `project_parts.id`: a draft has
// no project_parts row, and the part is the only key both forms of the Parts
// table share — which is also how the browser already keys its rows. The path
// gained its `/quantity` suffix in the same change, so a stale tab sending the
// old URL with a project_parts id gets a clean 404 instead of silently editing
// whichever part happens to share that number.
//
// Draft and started both write; a stopped or completed project's rows are a
// closed record, not something to keep adjusting.
router.patch('/:id/parts/:partId/quantity', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  // No dedicated "invalid id" code exists for a project part (§5.5); a
  // malformed param reads the same as one that doesn't exist.
  const partId = requireId(req.params.partId, ErrorCodes.PROJECT_PART_NOT_FOUND);
  const data = projectPartUpdateSchema.parse(req.body);
  const userId = req.user?.id;

  const result = await withTransaction(async (client) => {
    // Shared, as every write against NAMED rows is: it only needs the status
    // to hold still, and holding it is what stops Start freezing the BOM
    // underneath a draft edit. Two edits to the SAME draft part are serialised
    // by the upsert itself, not by this lock.
    const project = await lockProject(client, projectId, 'shared');
    if (project.status !== 'draft' && project.status !== 'started') {
      throw new ApiError(409, ErrorCodes.PROJECT_NOT_STARTED);
    }

    const row =
      project.status === 'draft'
        ? await writeDraftPartQuantity(client, projectId, partId, data, userId)
        : await writeFrozenPartQuantity(client, projectId, partId, data, userId);

    // The card too: `missing_qty` against `ordered_qty` is what *Offers*
    // counts, so this write can move the project between columns. Answering
    // with both is what lets the browser patch the row and the card it
    // already has instead of reloading the table and the board behind it.
    // A draft's card never moves (§3.1 keeps it out of the derived columns
    // until Start), but it is answered with all the same, so the browser has
    // one response shape to handle rather than two.
    return { row, card: await loadBoardCard(client, projectId) };
  });

  res.json(result);
});

// POST /api/projects/:id/parts/recalculate — re-seed from today's free stock
// (§5.2, §5.3). Started projects only — NOT the same guard as the quantity
// PATCH above, which also accepts drafts (§12). A draft has nothing to
// re-seed: its rows are recomputed from live stock on every read already.
router.post('/:id/parts/recalculate', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const userId = req.user?.id;

  const result = await withTransaction(async (client) => {
    // The project's big lock, not the shared one the single-row writes take:
    // `reseedFromStock` locks every `project_parts` row of the project in
    // whatever order the scan returns them, which is only safe while nothing
    // else can be holding one of them. A pick list ticked at the same time
    // takes its rows in `pp.id` order, and the two orders together are a
    // deadlock — so they are made to take turns here instead.
    const project = await lockProject(client, projectId);
    requireStartedForPartsWrite(project.status);
    const reseed = await reseedFromStock(client, projectId);

    // §5.6: a recalculate can move the same field a manual PATCH does — the
    // one a purchasing dispute will be about — just without anyone typing
    // over it, so it gets the same audit trail rather than leaving the
    // change to be inferred later from an unexplained number.
    if (reseed.changed.length > 0) {
      const events = buildProjectPartQtyEvents(
        reseed.changed.map((part, i) => ({
          partName: part.part.name,
          before: reseed.changedFrom[i],
          after: { fromStockQty: part.fromStockQty, missingQty: part.missingQty },
        })),
      );
      await writeAudit(client, 'project', projectId, 'updated', changeSet({}, events), userId);
    }

    return {
      changed: reseed.changed,
      skipped: reseed.skipped,
      card: await loadBoardCard(client, projectId),
    };
  });

  res.json(result);
});

// Preparation (migration 026). Neither of the two routes below moves a
// quantity: the picks that filled the job box already did, line by line, and
// `project_parts.prepared_qty` is their sum. Marking records that every line
// is complete and un-marking takes that back, leaving the picks where they
// are. They carry a "started projects only" guard, because what they record is
// only true of a live project — the quantity PATCH above no longer does, since
// a purchase decision can be made before Start (§12), but nothing can be
// picked or prepared before there is a frozen BOM to pick from.

/** One audit event per mark or un-mark (§5.6): which sub-product, under which
 *  product, and which way it moved. */
function subProductPreparationEvents(
  labels: SubProductPreparationLabels,
  prepared: boolean,
): AuditEvent[] {
  return [
    {
      type: 'sub_product',
      tag: 'changed',
      label: labels.subProduct,
      scope: [{ type: 'product', label: labels.product }],
      from: prepared ? 'Not prepared' : 'Prepared',
      to: prepared ? 'Prepared' : 'Not prepared',
    },
  ];
}

/** The pair in a pick-list URL. No dedicated "invalid id" code for either half
 *  (§5.5): a malformed param reads the same as a pair this project never froze. */
function subProductRefFromParams(params: Record<string, string | string[]>) {
  return {
    projectProductId: requireId(params.projectProductId, ErrorCodes.SUB_PRODUCT_NOT_IN_PROJECT),
    subProductRevisionId: requireId(
      params.subProductRevisionId,
      ErrorCodes.SUB_PRODUCT_NOT_IN_PROJECT,
    ),
  };
}

// GET /api/projects/:id/preparations/:projectProductId/:subProductRevisionId/parts
// — one sub-product's pick list: what it needs, what the project holds, and
// which lines are already ticked off. Read-only, so no status guard: a project
// that has not frozen its BOM simply has no usage rows and answers with none.
router.get(
  '/:id/preparations/:projectProductId/:subProductRevisionId/parts',
  requireAuth,
  async (req, res) => {
    const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
    const rows = await loadSubProductParts(pool, projectId, subProductRefFromParams(req.params));
    res.json(rows);
  },
);

// PATCH /api/projects/:id/preparations/:projectProductId/:subProductRevisionId/picks
// — how much of each of a sub-product's pick-list lines is in the job box.
// This is the write that moves `project_parts.prepared_qty`, so it carries the
// same "started projects only" guard as every other write against a frozen BOM.
//
// A batch, and the whole list back. One line per request meant a transaction
// and a project lock per checkbox, and left every OTHER line of the list
// showing a stale `onHandQty` whenever two of them share a part. Both go away
// together: the batch is resolved against one locked read, and the answer is
// the list as it now stands, plus the board card the write may have moved.
router.patch(
  '/:id/preparations/:projectProductId/:subProductRevisionId/picks',
  requireAuth,
  async (req, res) => {
    const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
    const ref = subProductRefFromParams(req.params);
    const { picks } = projectPartPicksSchema.parse(req.body);

    const result = await withTransaction(async (client) => {
      await lockProjectForPartsWrite(client, projectId);
      const parts = await applySubProductPicks(client, projectId, ref, picks);
      return { parts, card: await loadBoardCard(client, projectId) };
    });

    res.json(result);
  },
);

// POST /api/projects/:id/preparations — mark one sub-product prepared. Refused
// with 409 SUB_PRODUCT_PARTS_UNAVAILABLE unless every part it needs is in hand.
router.post('/:id/preparations', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const ref = projectSubProductRefSchema.parse(req.body);
  const userId = req.user?.id;

  const card = await withTransaction(async (client) => {
    await lockProjectForPartsWrite(client, projectId);
    const labels = await markSubProductPrepared(client, projectId, ref, userId);
    await writeAudit(
      client,
      'project',
      projectId,
      'updated',
      changeSet({}, subProductPreparationEvents(labels, true)),
      userId,
    );
    return loadBoardCard(client, projectId);
  });

  res.json({ ...ref, prepared: true, card });
});

// DELETE /api/projects/:id/preparations/:projectProductId/:subProductRevisionId
// — take a mark back. The pair is in the path rather than a body because that
// is what identifies the row; `project_sub_product_preparations.id` is never
// shown to the client, which only ever knows the two ids it marked.
router.delete(
  '/:id/preparations/:projectProductId/:subProductRevisionId',
  requireAuth,
  async (req, res) => {
    const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
    const ref = subProductRefFromParams(req.params);
    const userId = req.user?.id;

    const card = await withTransaction(async (client) => {
      await lockProjectForPartsWrite(client, projectId);
      const labels = await unmarkSubProductPrepared(client, projectId, ref);
      await writeAudit(
        client,
        'project',
        projectId,
        'updated',
        changeSet({}, subProductPreparationEvents(labels, false)),
        userId,
      );
      return loadBoardCard(client, projectId);
    });

    res.json({ ...ref, prepared: false, card });
  },
);

// POST /api/projects/:id/start — freeze the BOM and claim stock (§5.2, §5.3).
// One transaction: the parts list is recomputed inside it, the sourcing
// columns are seeded from free stock, and the status flip lands with them or
// not at all. A started project is then neither editable nor deletable, which
// is what makes the frozen numbers trustworthy (decision 1).
router.post('/:id/start', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);

  const result = await withTransaction(async (client) => {
    const before = await lockProject(client, projectId);
    // Every non-draft status means the project was already started once:
    // stopped and completed are terminal (migration 023), so there is no path
    // back to a second freeze.
    if (before.status !== 'draft') {
      throw new ApiError(409, ErrorCodes.PROJECT_ALREADY_STARTED);
    }

    // Refuses a project with nothing to freeze, or one whose BOM carries a
    // quantity the frozen table could not hold (see `freezeProjectBom`).
    await freezeProjectBom(client, projectId);

    await client.query(
      `UPDATE projects SET status = 'started', started_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [projectId],
    );
    await writeAudit(
      client,
      'project',
      projectId,
      'updated',
      { fields: { status: { from: before.status, to: 'started' } } },
      req.user?.id,
    );

    // The board card alongside the project: every mutation answers with the
    // one card it changed so the browser patches its board instead of
    // reloading it, and the membership rule stays where it was (decision 2).
    return {
      project: await loadProject(client, projectId),
      card: await loadBoardCard(client, projectId),
    };
  });

  res.json(result);
});

// POST /api/projects/:id/stop — a status flip, and deliberately nothing else.
// The project's stock claims are released by the flip itself: §4.2 sums
// `reserved` over started projects only, so a stopped one stops competing
// without a row to delete. Its own frozen quantities are kept as the record
// of what it had claimed.
//
// §8.4, settled here: open supplier orders are LEFT ALONE. The app cannot
// cancel a real order — that is a phone call — so writing `cancelled` would
// record something it has no way to know. The goods still arrive and land in
// stock unreserved, because the project claiming them has already dropped out
// of the aggregate. Story 15 therefore adds only a count to the Stop
// confirmation ("3 open orders will still be delivered"), not a branch here.
router.post('/:id/stop', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);

  const result = await withTransaction(async (client) => {
    const before = await lockProject(client, projectId);
    if (before.status !== 'started') {
      throw new ApiError(409, ErrorCodes.PROJECT_NOT_STARTED);
    }

    await client.query(
      `UPDATE projects SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [projectId],
    );
    await writeAudit(
      client,
      'project',
      projectId,
      'updated',
      { fields: { status: { from: before.status, to: 'stopped' } } },
      req.user?.id,
    );

    // The board card alongside the project: every mutation answers with the
    // one card it changed so the browser patches its board instead of
    // reloading it, and the membership rule stays where it was (decision 2).
    return {
      project: await loadProject(client, projectId),
      card: await loadBoardCard(client, projectId),
    };
  });

  res.json(result);
});

// PATCH /api/projects/:id — replace fields and the whole product set.
// Draft only: 409 PROJECT_NOT_EDITABLE otherwise.
router.patch('/:id', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const data = projectPayloadSchema.parse(req.body);
  const revisionInfo = await validateProductSet(data.products);

  const userId = req.user?.id;
  const result = await withTransaction(async (client) => {
    const before = await lockProject(client, projectId);
    if (before.status !== 'draft') {
      throw new ApiError(409, ErrorCodes.PROJECT_NOT_EDITABLE);
    }

    // Snapshot the current product set (with names) before replacing it, so
    // the audit log can diff old vs new the same way BOM-line edits do.
    const oldProducts = await client.query<{
      productRevisionId: number;
      name: string;
      revisionLabel: string;
      quantity: number;
    }>(
      `SELECT pp.product_revision_id AS "productRevisionId", p.name,
         pr.label AS "revisionLabel", pp.quantity
       FROM project_products pp
       JOIN products p ON p.id = pp.product_id
       JOIN product_revisions pr ON pr.id = pp.product_revision_id
       WHERE pp.project_id = $1`,
      [projectId],
    );

    // RETURNING the written row (not the raw payload) so the audit diff below
    // reflects what's actually in the database — `data.description || null`
    // can turn an incoming '' into a stored NULL, and the diff must agree.
    const updated = await client.query<{
      name: string;
      description: string | null;
      deadline: string | null;
    }>(
      `UPDATE projects SET name = $1, description = $2, deadline = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline`,
      [data.name, data.description || null, data.deadline || null, projectId],
    );
    const after = updated.rows[0];
    await client.query(`DELETE FROM project_products WHERE project_id = $1`, [projectId]);
    await insertProjectProducts(client, projectId, data.products);
    // A part the new product set no longer needs has no row to carry its
    // typed purchase quantity into, so keeping it would only mean silently
    // re-applying a decision nobody restated if the product were added back
    // (§12).
    await pruneDraftPartQuantities(client, projectId);

    const fields = diffFields(
      { name: before.name, description: before.description, deadline: before.deadline },
      after,
      ['name', 'description', 'deadline'],
    );

    const newKeyed = productsToKeyed(
      data.products.map((p) => ({
        productRevisionId: p.productRevisionId,
        name: revisionInfo.get(p.productRevisionId)!.productName,
        revisionLabel: revisionInfo.get(p.productRevisionId)!.revisionLabel,
        quantity: p.quantity,
      })),
    );
    const events = diffKeyedEvents(productsToKeyed(oldProducts.rows), newKeyed, 'product');

    await writeAudit(
      client,
      'project',
      projectId,
      'updated',
      changeSet(fields, events),
      userId,
    );

    // The board card alongside the project: every mutation answers with the
    // one card it changed so the browser patches its board instead of
    // reloading it, and the membership rule stays where it was (decision 2).
    return {
      project: await loadProject(client, projectId),
      card: await loadBoardCard(client, projectId),
    };
  });

  res.json(result);
});

// DELETE /api/projects/:id — draft only: 409 PROJECT_NOT_EDITABLE otherwise.
// Cascades remove its products (migration 023) and any purchase quantities
// typed against it (migration 027). Those two are all a draft can have: the
// BOM, and everything hanging off it, only freezes at Start.
router.delete('/:id', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);

  await withTransaction(async (client) => {
    const project = await lockProject(client, projectId);
    if (project.status !== 'draft') {
      throw new ApiError(409, ErrorCodes.PROJECT_NOT_EDITABLE);
    }

    await client.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await writeAudit(
      client,
      'project',
      projectId,
      'deleted',
      { snapshot: { name: project.name } },
      req.user?.id,
    );
  });

  res.json({ id: projectId, deleted: true });
});

export default router;
