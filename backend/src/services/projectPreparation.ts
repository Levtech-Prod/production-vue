// Sub-product preparation — the *Preparation* and *Prepared* columns of the
// board (projects-preparation-plan.md §11.13, §11.14, migration 026).
//
// Preparation is done one sub-product at a time, so the board splits a started
// project into one card per (product-in-the-project, sub-product revision) pair
// its frozen BOM mentions. `project_part_usages` already holds those pairs;
// what this file adds is the pick list behind each card and the mark that
// closes it.
//
// ONE NUMBER DOES THE WORK. `project_part_usages.picked_qty` is what has been
// pulled into the job box for that line, and `project_parts.prepared_qty` is
// its sum across the part's usage rows, written in the same transaction. That
// is why picking is the only thing here that moves a quantity: marking a
// sub-product prepared merely records that every line is complete, and taking
// the mark back merely records that it is not. The parts come back to the
// shelf by lowering the picks that put them in the box — one action, one
// meaning, and no second copy of the same total to keep in step.
//
// A WHOLE LIST AT A TIME. Picking is written as a batch over one sub-product
// (`applySubProductPicks`), not a line at a time. Filling a pick list is one
// action far more often than thirty, and the per-line version was thirty
// transactions each taking their own project-wide lock — while still leaving
// the lines it did not write showing a headroom a sibling had just moved,
// because two lines of one project can draw on the same part.
import type { PoolClient } from 'pg';
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import type { Queryable } from '../db.js';
import type { ProjectSubProductRef } from '../schemas/projects.schema.js';

/** One sub-product of one pinned product, as a board card (§4.1). */
export interface ProjectBoardSubProduct {
  projectProductId: number;
  subProductRevisionId: number;
  name: string;
  sku: string | null;
  revisionLabel: string;
  /** Distinct parts this sub-product needs, frozen at Start. */
  partCount: number;
  /** How many of those the project can still finish off today: already picked
   *  in full, or holding enough to cover what the line has left. */
  readyPartCount: number;
  /** Pieces across every line: what the sub-product needs, and what is already
   *  in its box. Quantities rather than a count of finished lines, so the card
   *  moves when someone pulls 2 of the 5 a line needs — and because
   *  `pickedQty === requiredQty` can only happen when every line is full (no
   *  line may exceed its own requirement), it is also the test for whether the
   *  sub-product can be marked prepared. */
  requiredQty: number;
  pickedQty: number;
  prepared: boolean;
  /** Whether this sub-product belongs in the *Preparation* column: unfinished,
   *  and either already part-way into its box or holding something that could
   *  go in today. Derived here rather than in the browser so the board cannot
   *  contradict the data (decision 2). */
  inPreparation: boolean;
}

type BoardSubProductRow = Omit<ProjectBoardSubProduct, 'inPreparation'> & {
  projectId: number;
  /** Lines with something left to pick and stock to pick it from. Not part of
   *  the card's own payload — it exists to answer `inPreparation`. */
  pickablePartCount: number;
};

/**
 * Every project's sub-products, keyed by project id, for the board payload.
 *
 * Deliberately a second round trip rather than another sub-select in the board
 * query: that query aggregates over `project_parts`, and joining the usage rows
 * into it would multiply the rows its line counts are computed from.
 *
 * `readyPartCount` compares what the project still holds unpicked — from stock
 * plus received, minus everything already in a box — against what THIS line has
 * left to pick. The holding is per part, not per sub-product, so two
 * sub-products sharing a scarce part can both read "ready" while only one of
 * them can actually be filled; picking for the first drops the second to short,
 * which is what the shelf does too.
 */
export async function loadBoardSubProducts(
  db: Queryable,
  projectIds: number[],
): Promise<Map<number, ProjectBoardSubProduct[]>> {
  const byProject = new Map<number, ProjectBoardSubProduct[]>();
  if (projectIds.length === 0) return byProject;

  const result = await db.query<BoardSubProductRow>(
    `SELECT
       pp.project_id                   AS "projectId",
       ppu.project_product_id          AS "projectProductId",
       ppu.sub_product_revision_id     AS "subProductRevisionId",
       sp.name,
       sp.sku,
       spr.label                       AS "revisionLabel",
       COUNT(*)::int                   AS "partCount",
       COUNT(*) FILTER (
         WHERE pp.from_stock_qty + pp.received_qty - pp.prepared_qty
               >= ppu.qty_per_unit * pprod.quantity - ppu.picked_qty
       )::int                          AS "readyPartCount",
       SUM(ppu.qty_per_unit * pprod.quantity)::int AS "requiredQty",
       SUM(ppu.picked_qty)::int        AS "pickedQty",
       COUNT(*) FILTER (
         WHERE ppu.picked_qty < ppu.qty_per_unit * pprod.quantity
           AND pp.from_stock_qty + pp.received_qty - pp.prepared_qty > 0
       )::int                          AS "pickablePartCount",
       (prep.id IS NOT NULL)           AS prepared
     FROM project_part_usages ppu
     JOIN project_parts pp          ON pp.id = ppu.project_part_id
     JOIN project_products pprod    ON pprod.id = ppu.project_product_id
     JOIN sub_product_revisions spr ON spr.id = ppu.sub_product_revision_id
     JOIN sub_products sp           ON sp.id = spr.sub_product_id
     LEFT JOIN project_sub_product_preparations prep
            ON prep.project_product_id = ppu.project_product_id
           AND prep.sub_product_revision_id = ppu.sub_product_revision_id
     WHERE pp.project_id = ANY($1::int[])
     GROUP BY pp.project_id, ppu.project_product_id, ppu.sub_product_revision_id,
              sp.name, sp.sku, spr.label, prep.id, pprod.position, pprod.id
     ORDER BY pprod.position, pprod.id, sp.name`,
    [projectIds],
  );

  for (const { projectId, pickablePartCount, ...row } of result.rows) {
    // A card appears once there is something to do and stays until the
    // sub-product is marked. `pickedQty > 0` is the half that keeps it there:
    // ANY quantity already in the box holds the card on the board, even a
    // partial pick on a line the shelf can no longer finish. Counting finished
    // LINES here instead would drop the card — and the modal with it — at
    // exactly the moment the 2-of-5 case is half done, stranding the parts
    // already pulled with no way back to them.
    const subProduct = {
      ...row,
      inPreparation: !row.prepared && (row.pickedQty > 0 || pickablePartCount > 0),
    };
    const list = byProject.get(projectId);
    if (list) list.push(subProduct);
    else byProject.set(projectId, [subProduct]);
  }
  return byProject;
}

/** How a marked or un-marked sub-product is named in the audit log. */
export interface SubProductPreparationLabels {
  subProduct: string;
  product: string;
}

interface SubProductUsageRow {
  requiredQty: number;
  pickedQty: number;
  subProductName: string;
  subProductRevisionLabel: string;
  productName: string;
  productRevisionLabel: string;
}

/**
 * The sub-product's usage rows with their `project_parts` and
 * `project_part_usages` rows locked, or 404. Both callers need the same two
 * things out of it: proof the pair is one this project froze, and the labels
 * its audit event is written with.
 *
 * The lock is what makes marking honest. Without it the "every line is picked
 * in full" check below is an unlocked read, and a pick that lowers a line
 * between that read and the INSERT leaves a sub-product recorded as prepared
 * with an incomplete list — which `applySubProductPicks` then refuses to
 * correct, because it will not edit a prepared sub-product. Ordered by
 * `pp.id`, over the same rows and in the same order `applySubProductPicks`
 * locks them, so the two can never deadlock against each other.
 */
async function loadSubProductUsages(
  client: PoolClient,
  projectId: number,
  ref: ProjectSubProductRef,
): Promise<SubProductUsageRow[]> {
  const result = await client.query<SubProductUsageRow>(
    `SELECT
       ppu.qty_per_unit * pprod.quantity AS "requiredQty",
       ppu.picked_qty                    AS "pickedQty",
       sp.name                           AS "subProductName",
       spr.label                         AS "subProductRevisionLabel",
       prod.name                         AS "productName",
       prev.label                        AS "productRevisionLabel"
     FROM project_part_usages ppu
     JOIN project_parts pp          ON pp.id = ppu.project_part_id
     JOIN project_products pprod    ON pprod.id = ppu.project_product_id
     JOIN products prod             ON prod.id = pprod.product_id
     JOIN product_revisions prev    ON prev.id = pprod.product_revision_id
     JOIN sub_product_revisions spr ON spr.id = ppu.sub_product_revision_id
     JOIN sub_products sp           ON sp.id = spr.sub_product_id
     WHERE pp.project_id = $1
       AND ppu.project_product_id = $2
       AND ppu.sub_product_revision_id = $3
     ORDER BY pp.id
     FOR UPDATE OF pp, ppu`,
    [projectId, ref.projectProductId, ref.subProductRevisionId],
  );
  if (result.rows.length === 0) {
    throw new ApiError(404, ErrorCodes.SUB_PRODUCT_NOT_IN_PROJECT);
  }
  return result.rows;
}

function labelsOf(usages: SubProductUsageRow[]): SubProductPreparationLabels {
  const first = usages[0];
  return {
    subProduct: `${first.subProductName} (${first.subProductRevisionLabel})`,
    product: `${first.productName} (${first.productRevisionLabel})`,
  };
}

/**
 * Record that one sub-product is prepared. Moves no quantity: the picks that
 * filled the box already did, line by line, which is the only reason this can
 * be a plain insert. Refused unless every line is complete — half a
 * sub-product prepared would put a card in *Prepared* that nobody can build
 * from.
 */
export async function markSubProductPrepared(
  client: PoolClient,
  projectId: number,
  ref: ProjectSubProductRef,
  userId: number | null | undefined,
): Promise<SubProductPreparationLabels> {
  const usages = await loadSubProductUsages(client, projectId, ref);
  if (usages.some((u) => u.pickedQty < u.requiredQty)) {
    throw new ApiError(409, ErrorCodes.SUB_PRODUCT_PARTS_NOT_PICKED);
  }


  const inserted = await client.query<{ id: number }>(
    `INSERT INTO project_sub_product_preparations
       (project_product_id, sub_product_revision_id, prepared_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_product_id, sub_product_revision_id) DO NOTHING
     RETURNING id`,
    [ref.projectProductId, ref.subProductRevisionId, userId ?? null],
  );
  if (inserted.rows.length === 0) {
    throw new ApiError(409, ErrorCodes.SUB_PRODUCT_ALREADY_PREPARED);
  }

  return labelsOf(usages);
}

/**
 * Take the mark back: the sub-product is not finished after all, and its card
 * returns to *Preparation* with its pick list as it stands.
 *
 * The picks are deliberately left alone. Un-marking answers "this is not
 * done", which is a different statement from "these parts went back on the
 * shelf" — and the second one now has its own way of being said, by lowering
 * the picked quantity on the lines it applies to. Clearing them here would
 * make the common case (marked the wrong card, parts still in the box) destroy
 * work to undo a click.
 */
export async function unmarkSubProductPrepared(
  client: PoolClient,
  projectId: number,
  ref: ProjectSubProductRef,
): Promise<SubProductPreparationLabels> {
  const usages = await loadSubProductUsages(client, projectId, ref);

  const deleted = await client.query<{ id: number }>(
    `DELETE FROM project_sub_product_preparations
     WHERE project_product_id = $1 AND sub_product_revision_id = $2
     RETURNING id`,
    [ref.projectProductId, ref.subProductRevisionId],
  );
  if (deleted.rows.length === 0) {
    throw new ApiError(409, ErrorCodes.SUB_PRODUCT_NOT_PREPARED);
  }

  return labelsOf(usages);
}

/** One pick-list line as the write about to change it sees it. */
export interface PickLineState {
  /** What the line needs, across the product's project quantity. */
  requiredQty: number;
  /** What is already in the box for it. */
  pickedQty: number;
  /** What the project holds for that part and has put in no box yet. */
  unpickedQty: number;
}

/**
 * How much `project_parts.prepared_qty` moves when a line is set to
 * `pickedQty`, or the reason it may not be. Pure, so both ceilings and the
 * order they are reported in are testable with no database (CLAUDE.md's first
 * tier) — the same shape `resolveProjectPartUpdate` uses for the Parts table's
 * two floors.
 *
 * The ceilings are enforced in opposite places on purpose. The per-line one is
 * this function's alone: it spans `project_part_usages` and `project_products`,
 * so no CHECK can hold it. The project-wide one is really enforced by
 * `chk_project_parts_prepared_within_pickable`; repeating it here only buys a
 * reason in place of a constraint violation. A NEGATIVE delta is always
 * allowed — putting parts back needs no headroom.
 *
 * `pickedQty` is assumed non-negative; the zod schema at the boundary is what
 * guarantees it.
 */
export function resolvePickQty(current: PickLineState, pickedQty: number): number {
  if (pickedQty > current.requiredQty) {
    throw new ApiError(422, ErrorCodes.PICKED_QTY_ABOVE_REQUIRED);
  }
  const delta = pickedQty - current.pickedQty;
  if (delta > current.unpickedQty) {
    throw new ApiError(409, ErrorCodes.SUB_PRODUCT_PARTS_UNAVAILABLE);
  }
  return delta;
}

/** One line of a batch, as `resolveBulkPicks` needs to see it. */
export interface BulkPickLine extends PickLineState {
  usageId: number;
  /** The `project_parts` row this line's picked quantity is summed onto, and
   *  the key the headroom below is tracked by — `unpickedQty` is a per-PART
   *  number, so lines sharing this id are looking at one pile. Today's only
   *  caller passes one sub-product's list, where `project_part_usages`' UNIQUE
   *  on (part, product, revision) means each id appears exactly once; the
   *  tracking is what keeps the resolver right for a batch that ever spans
   *  more than that, and what makes it safe to read as "resolve these picks"
   *  rather than "resolve these picks, one sub-product at a time". */
  projectPartId: number;
}

/** One line the batch actually moves, and by how much. */
export interface ResolvedPick {
  usageId: number;
  projectPartId: number;
  requiredQty: number;
  /** The absolute quantity to store. */
  pickedQty: number;
  delta: number;
}

export interface ResolvedBulkPicks {
  /** Only the lines that move. A line re-sent at the quantity it already
   *  holds is not a write, and a "pick everything" over a half-filled list
   *  is mostly such lines. */
  moved: ResolvedPick[];
  /** Net movement per `project_parts` row, so the write below is one UPDATE
   *  per part rather than one per line. */
  deltaByProjectPart: Map<number, number>;
}

/** Which way a line is being moved: -1 puts parts back, +1 takes more, 0
 *  leaves it (or is not in the batch at all). */
function pickDirection(line: BulkPickLine, requested: Map<number, number>): number {
  const want = requested.get(line.usageId);
  if (want === undefined || want === line.pickedQty) return 0;
  return want < line.pickedQty ? -1 : 1;
}

/**
 * Resolve a whole batch of picks against one shared pile per part.
 *
 * `unpickedQty` on every line is the holding of that line's PART across the
 * whole project, so lines sharing a part are looking at one pile. The running
 * headroom below is what keeps that honest: the project-wide ceiling is really
 * `chk_project_parts_prepared_within_pickable`, and a batch that let two lines
 * each claim the last three pieces would reach it as a raw 23514 naming
 * nothing. Within one sub-product's list a part cannot appear twice, so today
 * that tracking is a guarantee rather than a fix — the sharing this service
 * actually has to get right happens BETWEEN sub-products, one request after
 * another, and is handled by reading the holding under the write's own lock.
 *
 * Lines that put parts back are resolved first. Putting parts back needs no
 * headroom, so doing it first can only ever make a batch more likely to be
 * accepted — and it is what lets one batch move a piece from one line to
 * another of the same part. Among lines pulling in the same direction the
 * caller's order is kept (`sort` is stable), which for the only caller is the
 * `pp.id, ppu.id` order the rows were locked in: two lines competing for the
 * last piece resolve the same way every time rather than by request order.
 *
 * Pure, so the shared-pile arithmetic — the part of this that a loop over
 * `resolvePickQty` gets wrong — is tested with no database.
 */
export function resolveBulkPicks(
  lines: BulkPickLine[],
  requested: Map<number, number>,
): ResolvedBulkPicks {
  const headroom = new Map<number, number>();
  for (const line of lines) {
    if (!headroom.has(line.projectPartId)) headroom.set(line.projectPartId, line.unpickedQty);
  }

  const moved: ResolvedPick[] = [];
  const deltaByProjectPart = new Map<number, number>();

  for (const line of [...lines].sort(
    (a, b) => pickDirection(a, requested) - pickDirection(b, requested),
  )) {
    const want = requested.get(line.usageId);
    if (want === undefined) continue;

    const available = headroom.get(line.projectPartId) ?? 0;
    const delta = resolveLinePick(line, available, want);
    headroom.set(line.projectPartId, available - delta);
    if (delta === 0) continue;

    moved.push({
      usageId: line.usageId,
      projectPartId: line.projectPartId,
      requiredQty: line.requiredQty,
      pickedQty: want,
      delta,
    });
    deltaByProjectPart.set(
      line.projectPartId,
      (deltaByProjectPart.get(line.projectPartId) ?? 0) + delta,
    );
  }

  return { moved, deltaByProjectPart };
}

/** `resolvePickQty` against the batch's running headroom, naming the line it
 *  refused: a batch of thirty ticked at once has to be able to point at the
 *  one row that stopped it. */
function resolveLinePick(line: BulkPickLine, available: number, pickedQty: number): number {
  try {
    return resolvePickQty(
      { requiredQty: line.requiredQty, pickedQty: line.pickedQty, unpickedQty: available },
      pickedQty,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ApiError(err.status, err.code, { ...err.payload, usageId: line.usageId });
    }
    throw err;
  }
}

/** What a pick-list line's three quantities are, after any write to it. */
export interface ProjectPartPickState {
  usageId: number;
  /** What this line needs, across the product's project quantity. */
  requiredQty: number;
  /** How much of it is already in the job box. */
  pickedQty: number;
  /** The most this line could be picked to right now: what is in the box plus
   *  what the project still holds unpicked, capped at what the line needs. The
   *  holding is counted per part for the whole project, so two sub-products
   *  sharing a scarce part are looking at the same pile. */
  onHandQty: number;
}

/** One line of a sub-product's pick list — the Preparation card's modal. */
export interface ProjectSubProductPart extends ProjectPartPickState {
  partId: number;
  name: string;
  code: string;
}

export async function loadSubProductParts(
  db: Queryable,
  projectId: number,
  ref: ProjectSubProductRef,
): Promise<ProjectSubProductPart[]> {
  const result = await db.query<ProjectSubProductPart>(
    `SELECT
       ppu.id                            AS "usageId",
       p.id                              AS "partId",
       p.name,
       p.code,
       ppu.qty_per_unit * pprod.quantity AS "requiredQty",
       ppu.picked_qty                    AS "pickedQty",
       LEAST(
         ppu.qty_per_unit * pprod.quantity,
         ppu.picked_qty + pp.from_stock_qty + pp.received_qty - pp.prepared_qty
       )                                 AS "onHandQty"
     FROM project_part_usages ppu
     JOIN project_parts pp       ON pp.id = ppu.project_part_id
     JOIN parts p                ON p.id = pp.part_id
     JOIN project_products pprod ON pprod.id = ppu.project_product_id
     WHERE pp.project_id = $1
       AND ppu.project_product_id = $2
       AND ppu.sub_product_revision_id = $3
     ORDER BY p.name, p.id`,
    [projectId, ref.projectProductId, ref.subProductRevisionId],
  );
  return result.rows;
}

/** One line of a pick request: the absolute quantity now in the job box. */
export interface PickRequest {
  usageId: number;
  pickedQty: number;
}

/**
 * Set how much of one sub-product's pick list is in the job box — any number
 * of lines at once — and move the same net difference on
 * `project_parts.prepared_qty` so the two never disagree.
 *
 * ONE REQUEST, ONE TRANSACTION, WHOLE LIST. Filling a pick list is a "tick
 * everything that is here" action far more often than a line-by-line one, and
 * a round trip per line is not merely slow: each one was its own transaction
 * taking its own project lock, so ticking thirty parts serialized thirty
 * writes against every other write to that project. Taking the batch means
 * the shared-pile arithmetic (`resolveBulkPicks`) happens once against one
 * locked read, and two lines of one list sharing a scarce part can no longer
 * both be told there is room.
 *
 * THE WHOLE LIST IS LOCKED, not only the lines being written — the same set,
 * in the same `pp.id` order, that `markSubProductPrepared` takes. Two reasons:
 * a pick that lands between the mark's completeness check and its INSERT would
 * record a sub-product prepared with an incomplete list, and the untouched
 * lines' `onHandQty` moves when a sibling takes from the same part, so they
 * are returned too and must be read under the same lock as the write.
 *
 * Scoped by project id AND by the sub-product pair, so a line belonging to
 * another project — or to another sub-product of this one — cannot be reached
 * through this URL.
 *
 * Deliberately not audited (§5.6): a pick is adjusted freely while the box is
 * filling, and a log of every keystroke would bury the mark that closes it.
 */
export async function applySubProductPicks(
  client: PoolClient,
  projectId: number,
  ref: ProjectSubProductRef,
  requests: PickRequest[],
): Promise<ProjectPartPickState[]> {
  // Last value wins for a line named twice: the request is a set of absolute
  // quantities, not a sequence of movements, so the only sane reading of a
  // repeat is that the caller changed its mind before sending.
  const requested = new Map(requests.map((r) => [r.usageId, r.pickedQty]));

  const current = await client.query<BulkPickLine & { prepared: boolean }>(
    `SELECT
       ppu.id                                                AS "usageId",
       pp.id                                                 AS "projectPartId",
       ppu.qty_per_unit * pprod.quantity                     AS "requiredQty",
       ppu.picked_qty                                        AS "pickedQty",
       pp.from_stock_qty + pp.received_qty - pp.prepared_qty AS "unpickedQty",
       (prep.id IS NOT NULL)                                 AS prepared
     FROM project_part_usages ppu
     JOIN project_parts pp       ON pp.id = ppu.project_part_id
     JOIN project_products pprod ON pprod.id = ppu.project_product_id
     LEFT JOIN project_sub_product_preparations prep
            ON prep.project_product_id = ppu.project_product_id
           AND prep.sub_product_revision_id = ppu.sub_product_revision_id
     WHERE pp.project_id = $1
       AND ppu.project_product_id = $2
       AND ppu.sub_product_revision_id = $3
     ORDER BY pp.id
     FOR UPDATE OF pp, ppu`,
    [projectId, ref.projectProductId, ref.subProductRevisionId],
  );
  const lines = current.rows;
  if (lines.length === 0) throw new ApiError(404, ErrorCodes.SUB_PRODUCT_NOT_IN_PROJECT);

  // A finished sub-product's box is not open for editing; its card is in
  // *Prepared*, and changing a pick under it would move prepared_qty for a
  // sub-product that is already counted as done.
  if (lines[0].prepared) throw new ApiError(409, ErrorCodes.SUB_PRODUCT_ALREADY_PREPARED);

  // A line this sub-product does not have is a 404 rather than something to
  // skip quietly: the caller believes it is writing to it.
  const known = new Set(lines.map((line) => line.usageId));
  for (const usageId of requested.keys()) {
    if (!known.has(usageId)) {
      throw new ApiError(404, ErrorCodes.PROJECT_PART_USAGE_NOT_FOUND, { usageId });
    }
  }

  const { moved, deltaByProjectPart } = resolveBulkPicks(lines, requested);

  if (moved.length > 0) {
    // One statement per table for the whole batch, and `project_parts` first:
    // its CHECK runs per statement, and the net delta per part is what
    // `resolveBulkPicks` has already proved fits.
    const partIds = [...deltaByProjectPart.keys()];
    await client.query(
      `UPDATE project_parts AS pp
       SET prepared_qty = pp.prepared_qty + u.delta, updated_at = NOW()
       FROM unnest($1::int[], $2::int[]) AS u(id, delta)
       WHERE pp.id = u.id`,
      [partIds, partIds.map((id) => deltaByProjectPart.get(id) ?? 0)],
    );
    await client.query(
      `UPDATE project_part_usages AS ppu
       SET picked_qty = u.picked_qty
       FROM unnest($1::int[], $2::int[]) AS u(id, picked_qty)
       WHERE ppu.id = u.id`,
      [moved.map((m) => m.usageId), moved.map((m) => m.pickedQty)],
    );
  }

  // Every line, not only the written ones: taking from a shared part lowers
  // what its siblings could still be filled to, and a caller that had to ask
  // again to find that out would be back to two round trips.
  const newPickedByUsage = new Map(moved.map((m) => [m.usageId, m.pickedQty]));
  return lines.map((line) => {
    const pickedQty = newPickedByUsage.get(line.usageId) ?? line.pickedQty;
    const unpickedQty = line.unpickedQty - (deltaByProjectPart.get(line.projectPartId) ?? 0);
    return {
      usageId: line.usageId,
      requiredQty: line.requiredQty,
      pickedQty,
      onHandQty: Math.min(line.requiredQty, pickedQty + unpickedQty),
    };
  });
}
