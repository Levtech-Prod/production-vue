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
  /** How many lines are picked in full. All of them is what lets the
   *  sub-product be marked prepared. */
  pickedPartCount: number;
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
       COUNT(*) FILTER (
         WHERE ppu.picked_qty >= ppu.qty_per_unit * pprod.quantity
       )::int                          AS "pickedPartCount",
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
    // sub-product is marked: a line already part-picked keeps it on the board
    // even when the shelf has nothing more to give, and a list picked in full
    // keeps it there until someone marks it. Only "nothing picked and nothing
    // to pick" means no card — the same "some parts are available" rule the
    // column always had, now asked one sub-product at a time.
    const subProduct = {
      ...row,
      inPreparation: !row.prepared && (row.pickedPartCount > 0 || pickablePartCount > 0),
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
 * The sub-product's usage rows, or 404. Both callers need the same two things
 * out of it: proof the pair is one this project froze, and the labels its audit
 * event is written with.
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
       AND ppu.sub_product_revision_id = $3`,
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

/**
 * Set how much of one pick-list line is in the job box, and move the same
 * difference on `project_parts.prepared_qty` so the two never disagree.
 *
 * Scoped by project id so a line belonging to another project cannot be
 * reached through this one's URL. The two ceilings are checked in opposite
 * places on purpose: the per-line one here, because it spans two tables and no
 * CHECK can hold it, and the project-wide one by
 * `chk_project_parts_prepared_within_pickable` — this only pre-empts it to
 * answer with a reason instead of a constraint violation.
 *
 * Deliberately not audited (§5.6): a pick is adjusted freely while the box is
 * filling, and a log of every keystroke would bury the mark that closes it.
 */
export async function setUsagePickedQty(
  client: PoolClient,
  projectId: number,
  projectPartUsageId: number,
  pickedQty: number,
): Promise<ProjectPartPickState> {
  const current = await client.query<{
    projectPartId: number;
    requiredQty: number;
    pickedQty: number;
    /** What the project holds and has not put in any box yet. */
    unpickedQty: number;
    prepared: boolean;
  }>(
    `SELECT
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
     WHERE ppu.id = $1 AND pp.project_id = $2
     FOR UPDATE OF pp`,
    [projectPartUsageId, projectId],
  );
  const row = current.rows[0];
  if (!row) throw new ApiError(404, ErrorCodes.PROJECT_PART_USAGE_NOT_FOUND);
  // A finished sub-product's box is not open for editing; its card is in
  // *Prepared*, and changing a pick under it would move prepared_qty for a
  // sub-product that is already counted as done.
  if (row.prepared) throw new ApiError(409, ErrorCodes.SUB_PRODUCT_ALREADY_PREPARED);
  if (pickedQty > row.requiredQty) {
    throw new ApiError(422, ErrorCodes.PICKED_QTY_ABOVE_REQUIRED);
  }

  const delta = pickedQty - row.pickedQty;
  if (delta > row.unpickedQty) {
    throw new ApiError(409, ErrorCodes.SUB_PRODUCT_PARTS_UNAVAILABLE);
  }

  if (delta !== 0) {
    await client.query(
      `UPDATE project_parts SET prepared_qty = prepared_qty + $1, updated_at = NOW()
       WHERE id = $2`,
      [delta, row.projectPartId],
    );
    await client.query(`UPDATE project_part_usages SET picked_qty = $1 WHERE id = $2`, [
      pickedQty,
      projectPartUsageId,
    ]);
  }

  return {
    usageId: projectPartUsageId,
    requiredQty: row.requiredQty,
    pickedQty,
    onHandQty: Math.min(row.requiredQty, pickedQty + row.unpickedQty - delta),
  };
}
