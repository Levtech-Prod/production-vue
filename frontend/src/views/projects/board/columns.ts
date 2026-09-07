import type { ProjectBoardCard } from '../../../types/projects.ts';

export type BoardColumnKey = 'projects' | 'offers' | 'ordered' | 'preparation' | 'prepared';

/**
 * One of the board's five fixed columns (plan §4.1).
 *
 * `member` only reads the `in*` flags the API already derived — the
 * membership rule itself deliberately stays on the server, in one place, so
 * the board can never contradict the data (decision 2). `badge` picks which
 * of the card's counts that column shows.
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
  /** Omitted on *Projects*, whose count is the product list on the card. */
  badgeKey?: string;
  member: (project: ProjectBoardCard) => boolean;
  badge: (project: ProjectBoardCard) => number;
}

export interface BoardCard {
  project: ProjectBoardCard;
  badge: number;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  {
    key: 'projects',
    titleKey: 'project_column.projects',
    emptyKey: 'project_column.empty_projects',
    dotClass: 'bg-slate-400',
    member: () => true,
    badge: (p) => p.products.length,
  },
  {
    key: 'offers',
    titleKey: 'project_column.offers',
    emptyKey: 'project_column.empty_derived',
    dotClass: 'bg-violet-500',
    badgeKey: 'n_parts_to_buy',
    member: (p) => p.inOffers,
    badge: (p) => p.toBuyLines,
  },
  {
    key: 'ordered',
    titleKey: 'project_column.ordered',
    emptyKey: 'project_column.empty_derived',
    dotClass: 'bg-blue-500',
    badgeKey: 'n_parts_on_order',
    member: (p) => p.inOrdered,
    badge: (p) => p.onOrderLines,
  },
  {
    key: 'preparation',
    titleKey: 'project_column.preparation',
    emptyKey: 'project_column.empty_derived',
    dotClass: 'bg-amber-500',
    badgeKey: 'n_parts_to_pick',
    member: (p) => p.inPreparation,
    badge: (p) => p.toPickLines,
  },
  {
    key: 'prepared',
    titleKey: 'project_column.prepared',
    emptyKey: 'project_column.empty_derived',
    dotClass: 'bg-emerald-500',
    badgeKey: 'n_parts_ready',
    member: (p) => p.inPrepared,
    badge: (p) => p.lineCount,
  },
];
