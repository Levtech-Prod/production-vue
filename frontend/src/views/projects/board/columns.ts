import type {
  ProjectBoardCard,
  ProjectBoardProduct,
  ProjectBoardSubProduct,
} from '../../../types/projects.ts';

export type BoardColumnKey = 'projects' | 'offers' | 'ordered' | 'preparation' | 'prepared';

/**
 * One card on the board. Four of the five columns put at most one card per
 * project; *Preparation* puts one per sub-product still to prepare, because
 * that is the unit the work is actually done in — hence the union rather than
 * an optional field that is only ever set in one column.
 */
export type BoardCard =
  | { kind: 'project'; project: ProjectBoardCard; badge: number }
  | ({ kind: 'subProduct' } & SubProductTarget);

/** One sub-product of one project, with the product it sits under — what both
 *  preparation actions act on, and what their confirmation dialogs name. */
export interface SubProductTarget {
  project: ProjectBoardCard;
  product: ProjectBoardProduct;
  subProduct: ProjectBoardSubProduct;
}

/**
 * One of the board's five fixed columns (plan §4.1).
 *
 * `cards` only reads the `in*` flags the API already derived — the membership
 * rule itself deliberately stays on the server, in one place, so the board can
 * never contradict the data (decision 2). What it does own is how many cards a
 * member project puts in the column, which is one everywhere but *Preparation*.
 *
 * `dotClass` is the only colour a column owns, and it lives in the header
 * alone: on a card, colour identifies the *project* (`utils/cardAccent.ts`),
 * so nothing inside a card is tinted by its column.
 */
export interface BoardColumn {
  key: BoardColumnKey;
  titleKey: string;
  emptyKey: string;
  dotClass: string;
  /** i18n key for the count badge, taking `{ n }`. Omitted on *Projects*,
   *  whose count is the product list, and on *Preparation*, whose cards say
   *  how many of their parts are in hand instead. */
  badgeKey?: string;
  cards: (project: ProjectBoardCard) => BoardCard[];
}

/** The one-card-per-project shape the four project-level columns share. */
function projectCard(
  member: boolean,
  project: ProjectBoardCard,
  badge: number,
): BoardCard[] {
  return member ? [{ kind: 'project', project, badge }] : [];
}

export const BOARD_COLUMNS: BoardColumn[] = [
  {
    key: 'projects',
    titleKey: 'project_column.projects',
    emptyKey: 'project_column.empty_projects',
    dotClass: 'bg-slate-400',
    cards: (p) => projectCard(true, p, p.products.length),
  },
  {
    key: 'offers',
    titleKey: 'project_column.offers',
    emptyKey: 'project_column.empty_until_started',
    dotClass: 'bg-violet-500',
    badgeKey: 'n_parts_to_buy',
    cards: (p) => projectCard(p.inOffers, p, p.toBuyLines),
  },
  {
    key: 'ordered',
    titleKey: 'project_column.ordered',
    emptyKey: 'project_column.empty_until_started',
    dotClass: 'bg-blue-500',
    badgeKey: 'n_parts_on_order',
    cards: (p) => projectCard(p.inOrdered, p, p.onOrderLines),
  },
  {
    key: 'preparation',
    titleKey: 'project_column.preparation',
    emptyKey: 'project_column.empty_preparation',
    dotClass: 'bg-amber-500',
    // One card per sub-product still to prepare: the preparation itself is
    // done a sub-product at a time, and a single project card could not say
    // which of them the parts on the shelf belong to. Which sub-products those
    // are is the server's call — `subProduct.inPreparation` — so the board
    // only has to pair each one with the product it sits under.
    cards: (p) =>
      p.inPreparation
        ? p.subProducts.flatMap((subProduct) => {
            if (!subProduct.inPreparation) return [];
            const product = p.products.find(
              (prod) => prod.projectProductId === subProduct.projectProductId,
            );
            return product ? [{ kind: 'subProduct' as const, project: p, product, subProduct }] : [];
          })
        : [],
  },
  {
    key: 'prepared',
    titleKey: 'project_column.prepared',
    emptyKey: 'project_column.empty_until_started',
    dotClass: 'bg-emerald-500',
    badgeKey: 'n_sub_products_prepared',
    // Back to one card per project, from the first sub-product finished
    // rather than the last (§8.1): the card names a percentage per product,
    // so an early *Prepared* says how far along the project is instead of
    // merely repeating that it is not done.
    cards: (p) =>
      projectCard(
        p.inPrepared,
        p,
        p.products.reduce((sum, product) => sum + product.preparedSubProducts, 0),
      ),
  },
];

/** Stable per-card key: a project puts one card in most columns but one per
 *  sub-product in *Preparation*, so its id alone is not unique there. */
export function cardKey(card: BoardCard): string {
  return card.kind === 'project'
    ? `p${card.project.id}`
    : `s${card.project.id}-${card.subProduct.projectProductId}-${card.subProduct.subProductRevisionId}`;
}

/** Prepared share of one product, as a whole percentage. Zero sub-products
 *  means nothing frozen for it yet, which is not the same as 0% done — the
 *  caller decides whether to show it at all. */
export function preparedPercent(product: ProjectBoardProduct): number {
  if (product.subProductCount === 0) return 0;
  return Math.round((product.preparedSubProducts / product.subProductCount) * 100);
}
