// The board payload (projects-preparation-plan.md §4.1): one card per project,
// with the column membership derived from its counts.
//
// This used to live inline in `GET /api/projects`, and moved here when the
// board stopped being refetched after every write. Each mutation now answers
// with the single card it changed and the browser patches that card into the
// board it already has, so this code has two callers instead of one — and the
// membership rule has to give the same answer to both or the board and the
// list it was loaded from would slowly disagree. One derivation, on the
// server, is what decision 2 asks for; two copies of it would be the exact
// thing that decision exists to prevent.
import type { Queryable } from '../db.js';
import type { ProjectStatus } from '../schemas/projects.schema.js';
import { loadBoardSubProducts, type ProjectBoardSubProduct } from './projectPreparation.js';

/** One product line as the board shows it, with its sub-product tally. */
export interface ProjectBoardProduct {
  projectProductId: number;
  name: string;
  sku: string;
  revisionLabel: string;
  quantity: number;
  subProductCount: number;
  preparedSubProducts: number;
}

export interface ProjectBoardCard {
  id: number;
  name: string;
  description: string | null;
  deadline: string | null;
  status: ProjectStatus;
  createdAt: string;
  products: ProjectBoardProduct[];
  subProducts: ProjectBoardSubProduct[];
  toBuyLines: number;
  onOrderLines: number;
  inOffers: boolean;
  inOrdered: boolean;
  inPreparation: boolean;
  inPrepared: boolean;
}

/** What the caller wants back. A list read passes `statuses` (and maybe `q`);
 *  a write passes the one `projectIds` it touched. Each filter is skipped when
 *  omitted, so the same statement serves both without a second query to keep
 *  in step with this one. */
export interface BoardCardFilter {
  statuses?: ProjectStatus[];
  q?: string | null;
  projectIds?: number[];
}

type BoardCardRow = Omit<
  ProjectBoardCard,
  'products' | 'subProducts' | 'inOffers' | 'inOrdered' | 'inPreparation' | 'inPrepared'
> & {
  products: Omit<ProjectBoardProduct, 'subProductCount' | 'preparedSubProducts'>[];
};

export async function loadBoardCards(
  db: Queryable,
  filter: BoardCardFilter,
): Promise<ProjectBoardCard[]> {
  const result = await db.query<BoardCardRow>(
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
                   -- The board needs the id to hang each product's
                   -- sub-product progress off (§4.1), not only its name.
                   'projectProductId', pprod.id,
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
       -- Only the two buying columns are counted off project_parts.
       -- Preparation progress is per sub-product (migration 026), everywhere
       -- it appears: the *Projects* card's bar, the *Preparation* cards' bars
       -- and the *Prepared* card's percentages all read the same fraction, so
       -- taking a mark back moves every one of them.
       COUNT(*) FILTER (WHERE pp.missing_qty  > pp.ordered_qty)::int  AS "toBuyLines",
       COUNT(*) FILTER (WHERE pp.ordered_qty  > pp.received_qty)::int AS "onOrderLines"
     FROM projects p
     LEFT JOIN project_parts pp ON pp.project_id = p.id
     -- Each filter drops out when the caller omits it, so a list read and a
     -- single-card read after a write run the same statement rather than two
     -- that have to be kept identical by hand.
     WHERE ($1::text[] IS NULL OR p.status = ANY($1::text[]))
       AND ($2::text   IS NULL OR p.name ILIKE '%' || $2 || '%')
       AND ($3::int[]  IS NULL OR p.id = ANY($3::int[]))
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [filter.statuses ?? null, filter.q ?? null, filter.projectIds ?? null],
  );

  // One extra round trip rather than another sub-select: the query above
  // aggregates over `project_parts`, and joining the usage rows into it would
  // multiply the rows its line counts are computed from. Read for every frozen
  // project, not only the ones in a derived column — a stopped project's
  // preparation state is part of the record, and the membership flags below
  // are what keep its cards off the board.
  const subProductsByProject = await loadBoardSubProducts(
    db,
    result.rows.map((row) => row.id),
  );

  // Column membership (§4.1): *Offers* and *Ordered* are ANY ("some parts
  // still need buying"). *Preparation* and *Prepared* are per sub-product
  // since migration 026 — a project sits in both at once while some of its
  // sub-products are done and others are not, which reads correctly because
  // the *Prepared* card carries a percentage per product (§8.1).
  //
  // Only a started or completed project reaches a derived column at all
  // (§3.1). A draft has no `project_parts` rows so its counts are zero
  // anyway, but a STOPPED project keeps the rows it froze while it ran,
  // and without this guard it would keep appearing under Offers or Ordered
  // instead of sitting greyed in *Projects* alone.
  return result.rows.map((row) => {
    const { status, toBuyLines, onOrderLines } = row;
    const derived = status === 'started' || status === 'completed';
    const subProducts = subProductsByProject.get(row.id) ?? [];
    return {
      ...row,
      // Each product carries its own sub-product tally, which is both the
      // progress bar on a *Preparation* card and the percentage the
      // *Prepared* card shows beside the product — one number, one meaning.
      products: row.products.map((product) => {
        const own = subProducts.filter((s) => s.projectProductId === product.projectProductId);
        return {
          ...product,
          subProductCount: own.length,
          preparedSubProducts: own.filter((s) => s.prepared).length,
        };
      }),
      subProducts,
      inOffers: derived && toBuyLines > 0,
      inOrdered: derived && onOrderLines > 0,
      inPreparation: derived && subProducts.some((s) => s.inPreparation),
      inPrepared: derived && subProducts.some((s) => s.prepared),
    };
  });
}

/**
 * The one card a write just changed, for the response that lets the browser
 * patch its board instead of reloading it.
 *
 * Deliberately not filtered by status: the caller has just written to this
 * project and is owed the truth about it, and whether the card still belongs
 * under the filters on screen is the board's own question — a Stop that moves
 * a project out of the default view has to be *told* to the board, not hidden
 * from it. Never null in practice, since every caller has the project's row
 * locked; typed nullable so a deleted project reads as a removal rather than
 * a crash.
 */
export async function loadBoardCard(
  db: Queryable,
  projectId: number,
): Promise<ProjectBoardCard | null> {
  const [card] = await loadBoardCards(db, { projectIds: [projectId] });
  return card ?? null;
}
