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
  projectPayloadSchema,
  projectListQuerySchema,
  projectPartUpdateSchema,
  type ProjectProductInput,
  type ProjectStatus,
} from '../schemas/projects.schema.js';
import {
  writeAudit,
  changeSet,
  diffFields,
  diffKeyedEvents,
  type KeyedValue,
} from '../services/audit.js';
import {
  freezeProjectBom,
  loadProjectPartsPayload,
  loadFrozenProjectBom,
  toProjectPartRows,
  resolveProjectPartUpdate,
  reseedFromStock,
} from '../services/projectBom.js';
import { buildProjectPartQtyEvents } from './projectPartAudit.js';

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

interface LockedProject {
  name: string;
  description: string | null;
  deadline: string | null;
  status: ProjectStatus;
}

/**
 * Lock the project row and read what any transition or edit needs of it, or
 * 404. Taking the lock as the status is read is the point: without it a Start
 * and a PATCH can both pass their own draft check and then both write.
 *
 * One column list for all four callers rather than four tailored SELECTs —
 * on a single row by primary key the extra columns cost nothing, and one
 * shape is one thing to keep true.
 */
async function lockProject(client: PoolClient, projectId: number): Promise<LockedProject> {
  const result = await client.query<LockedProject>(
    `SELECT name, description, to_char(deadline, 'YYYY-MM-DD') AS deadline, status
     FROM projects WHERE id = $1 FOR UPDATE`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new ApiError(404, ErrorCodes.PROJECT_NOT_FOUND);
  return project;
}

/**
 * Guard shared by the PATCH and recalculate routes below: both act on
 * `project_parts`, which only exists once Start has frozen it. A draft's rows
 * genuinely don't exist yet, so PROJECT_PARTS_NOT_FROZEN is literally true;
 * a stopped or completed project's rows exist but are a closed record, which
 * PROJECT_NOT_STARTED already means — the same code the Stop route itself
 * uses for "not currently started" — rather than reusing the "not generated"
 * wording for a project whose parts list plainly was generated.
 */
function requireStartedForPartsWrite(status: ProjectStatus): void {
  if (status === 'draft') throw new ApiError(409, ErrorCodes.PROJECT_PARTS_NOT_FROZEN);
  if (status !== 'started') throw new ApiError(409, ErrorCodes.PROJECT_NOT_STARTED);
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

// GET /api/projects — board payload (§4.1): per-project part-line counts,
// with column membership derived here (not in SQL) so the rule stays in one
// readable place. `?status=` is repeatable (defaults to draft+started, see
// §6.3); `?q=` searches the name.
router.get('/', requireAuth, async (req, res) => {
  const data = projectListQuerySchema.parse(req.query);

  const result = await query<{
    id: number;
    name: string;
    description: string | null;
    deadline: string | null;
    status: string;
    createdAt: string;
    products: { name: string; sku: string; revisionLabel: string; quantity: number }[];
    lineCount: number;
    toBuyLines: number;
    onOrderLines: number;
    toPickLines: number;
    doneLines: number;
  }>(
    `SELECT
       p.id,
       p.name,
       p.description,
       to_char(p.deadline, 'YYYY-MM-DD') AS deadline,
       p.status,
       p.created_at AS "createdAt",
       -- The card lists what the project builds, so the names travel with the
       -- board rather than costing one request per card. A sub-select, not a
       -- join: joining project_products alongside project_parts would
       -- multiply the rows the counts below are computed from.
       (SELECT COALESCE(
                 json_agg(json_build_object(
                   'name', prod.name,
                   'sku', prod.sku,
                   'revisionLabel', rev.label,
                   'quantity', pprod.quantity
                 ) ORDER BY pprod.position, pprod.id),
                 '[]')
        FROM project_products pprod
        JOIN products prod ON prod.id = pprod.product_id
        JOIN product_revisions rev ON rev.id = pprod.product_revision_id
        WHERE pprod.project_id = p.id) AS products,
       COUNT(pp.id)::int AS "lineCount",
       COUNT(*) FILTER (WHERE pp.missing_qty  > pp.ordered_qty)::int  AS "toBuyLines",
       COUNT(*) FILTER (WHERE pp.ordered_qty  > pp.received_qty)::int AS "onOrderLines",
       COUNT(*) FILTER (WHERE pp.from_stock_qty + pp.received_qty
                            > pp.prepared_qty)::int                  AS "toPickLines",
       -- Lines with nothing outstanding, for the card's progress bar and for
       -- *Prepared*. The three counts above overlap (a line can be
       -- part-ordered and part-pickable at once), so "done" is its own
       -- predicate rather than lineCount minus their sum.
       --
       -- The last term is not in §4.1 and is deliberate: the first three are
       -- all comparisons between sourcing columns, and zero equals zero, so a
       -- line requiring 5 pieces with nothing in stock, nothing ordered and
       -- nothing prepared satisfies all of them. Every CHECK on project_parts
       -- accepts that row, and PATCH /:id/parts/:id can produce it by setting
       -- missing_qty to 0 while ordered_qty is 0. Without the floor the card
       -- would read 100% prepared having obtained nothing.
       COUNT(*) FILTER (WHERE pp.missing_qty <= pp.ordered_qty
                          AND pp.ordered_qty <= pp.received_qty
                          AND pp.from_stock_qty + pp.received_qty
                              <= pp.prepared_qty
                          AND pp.prepared_qty >= pp.required_qty)::int AS "doneLines"
     FROM projects p
     LEFT JOIN project_parts pp ON pp.project_id = p.id
     WHERE p.status = ANY($1::text[])
       AND ($2::text IS NULL OR p.name ILIKE '%' || $2 || '%')
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [data.status, data.q ?? null],
  );

  // Column membership (§4.1): the middle three columns are ANY ("some parts
  // still need buying"), *Prepared* is ALL ("nothing outstanding any more").
  //
  // Only a started or completed project reaches a derived column at all
  // (§3.1). A draft has no `project_parts` rows so its counts are zero
  // anyway, but a *stopped* one keeps its rows while its claims are released,
  // and without this guard it would keep appearing under Offers or Ordered
  // instead of sitting greyed in *Projects* alone.
  const projects = result.rows.map((row) => {
    const { status, toBuyLines, onOrderLines, toPickLines, lineCount, doneLines } = row;
    const derived = status === 'started' || status === 'completed';
    return {
      ...row,
      inOffers: derived && toBuyLines > 0,
      inOrdered: derived && onOrderLines > 0,
      inPreparation: derived && toPickLines > 0,
      // Read off `doneLines` rather than re-testing the three counts: they are
      // the same question, and asking it twice is how the board and its
      // progress bar would come to disagree about what "finished" means.
      inPrepared: derived && lineCount > 0 && doneLines === lineCount,
    };
  });

  res.json(projects);
});

// POST /api/projects — create as `draft` with its pinned products.
router.post('/', requireAuth, async (req, res) => {
  const data = projectPayloadSchema.parse(req.body);
  await validateProductSet(data.products);

  const userId = req.user?.id;
  const project = await withTransaction(async (client) => {
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

    return loadProject(client, projectId);
  });

  res.json(project);
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

// PATCH /api/projects/:id/parts/:projectPartId — edit the sourcing columns by
// hand (§5.2). Started projects only: a draft has no `project_parts` rows yet
// (`GET /:id/parts` computes them live instead), and a stopped or completed
// project's rows are a closed record, not something to keep adjusting.
// PROJECT_PARTS_NOT_FROZEN covers both: this is a data-access guard on
// `project_parts`, distinct from PROJECT_NOT_STARTED, which guards the
// Start/Stop transitions themselves.
router.patch('/:id/parts/:projectPartId', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  // No dedicated "invalid id" code exists for a project part (§5.5); a
  // malformed param reads the same as one that doesn't exist.
  const projectPartId = requireId(req.params.projectPartId, ErrorCodes.PROJECT_PART_NOT_FOUND);
  const data = projectPartUpdateSchema.parse(req.body);
  const userId = req.user?.id;

  const row = await withTransaction(async (client) => {
    const project = await lockProject(client, projectId);
    requireStartedForPartsWrite(project.status);

    const current = await client.query<{
      partName: string;
      fromStockQty: number;
      missingQty: number;
      orderedQty: number;
      receivedQty: number;
      preparedQty: number;
    }>(
      `SELECT p.name AS "partName", pp.from_stock_qty AS "fromStockQty",
         pp.missing_qty AS "missingQty", pp.ordered_qty AS "orderedQty",
         pp.received_qty AS "receivedQty", pp.prepared_qty AS "preparedQty"
       FROM project_parts pp
       JOIN parts p ON p.id = pp.part_id
       WHERE pp.id = $1 AND pp.project_id = $2
       FOR UPDATE`,
      [projectPartId, projectId],
    );
    const before = current.rows[0];
    if (!before) throw new ApiError(404, ErrorCodes.PROJECT_PART_NOT_FOUND);

    // Throws 409 MISSING_QTY_BELOW_ORDERED / FROM_STOCK_QTY_BELOW_PREPARED
    // rather than silently clamping: a line can never be made to owe less
    // than it has already bought, or claim less stock than has already been
    // picked from it, and the API is what actually enforces that, not just
    // the input's client-side clamp.
    const resolved = resolveProjectPartUpdate(before, data);

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
        [resolved.fromStockQty, resolved.missingQty, projectPartId],
      );

      // §5.6: the field a purchasing dispute will be about.
      const events = buildProjectPartQtyEvents([
        {
          partName: before.partName,
          before: { fromStockQty: before.fromStockQty, missingQty: before.missingQty },
          after: { fromStockQty: resolved.fromStockQty, missingQty: resolved.missingQty },
        },
      ]);
      await writeAudit(client, 'project', projectId, 'updated', changeSet({}, events), userId);
    }

    const rows = toProjectPartRows(await loadFrozenProjectBom(client, projectId), 'started');
    const updated = rows.find((r) => r.id === projectPartId);
    if (!updated) throw new ApiError(404, ErrorCodes.PROJECT_PART_NOT_FOUND);
    return updated;
  });

  res.json(row);
});

// POST /api/projects/:id/parts/recalculate — re-seed from today's free stock
// (§5.2, §5.3). Same "started projects only" guard as the PATCH above.
router.post('/:id/parts/recalculate', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const userId = req.user?.id;

  const { changed, skipped } = await withTransaction(async (client) => {
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

    return reseed;
  });

  res.json({ changed, skipped });
});

// POST /api/projects/:id/start — freeze the BOM and claim stock (§5.2, §5.3).
// One transaction: the parts list is recomputed inside it, the sourcing
// columns are seeded from free stock, and the status flip lands with them or
// not at all. A started project is then neither editable nor deletable, which
// is what makes the frozen numbers trustworthy (decision 1).
router.post('/:id/start', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);

  const project = await withTransaction(async (client) => {
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

    return loadProject(client, projectId);
  });

  res.json(project);
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

  const project = await withTransaction(async (client) => {
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

    return loadProject(client, projectId);
  });

  res.json(project);
});

// PATCH /api/projects/:id — replace fields and the whole product set.
// Draft only: 409 PROJECT_NOT_EDITABLE otherwise.
router.patch('/:id', requireAuth, async (req, res) => {
  const projectId = requireId(req.params.id, ErrorCodes.INVALID_PROJECT_ID);
  const data = projectPayloadSchema.parse(req.body);
  const revisionInfo = await validateProductSet(data.products);

  const userId = req.user?.id;
  const project = await withTransaction(async (client) => {
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

    return loadProject(client, projectId);
  });

  res.json(project);
});

// DELETE /api/projects/:id — draft only: 409 PROJECT_NOT_EDITABLE otherwise.
// Cascades (see migration 023) remove its products; nothing else can
// reference a draft project since the BOM only freezes at Start.
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
