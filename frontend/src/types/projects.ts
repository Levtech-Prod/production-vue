// ---- Projects -------------------------------------------------------------

/** One pinned product line: the product, the revision the project is frozen
 *  to, and how many of it the project builds. */
export interface ProjectProduct {
  id: number;
  productId: number;
  name: string;
  sku: string;
  productRevisionId: number;
  revisionLabel: string;
  quantity: number;
  position: number;
}

/** A project with its pinned product set — what `GET/POST/PATCH
 *  /api/projects/:id` returns. */
export interface Project {
  id: number;
  name: string;
  description: string | null;
  /** 'YYYY-MM-DD', matching the `deadline DATE` column. */
  deadline: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  products: ProjectProduct[];
}

/**
 * One board card (`GET /api/projects`, plan §4.1). The `in*` flags are the
 * column membership, derived on the server from the line counts beside them
 * so the rule lives in exactly one place — the board only reads them.
 *
 * The counts are what each card shows as its column badge, which is why they
 * come back alongside the flags: *Prepared* stays dark until the very last
 * line closes, so "12 of 40 parts to buy" is what makes progress visible.
 */
export interface ProjectBoardCard {
  id: number;
  name: string;
  description: string | null;
  deadline: string | null;
  status: ProjectStatus;
  createdAt: string;
  /** What the project builds, in the order the modal pinned them. */
  products: ProjectBoardProduct[];
  lineCount: number;
  toBuyLines: number;
  onOrderLines: number;
  toPickLines: number;
  /** Lines with nothing outstanding — the card's progress bar. Not
   *  `lineCount` minus the three counts above: those overlap. */
  doneLines: number;
  inOffers: boolean;
  inOrdered: boolean;
  inPreparation: boolean;
  inPrepared: boolean;
}

/** One product line as the board shows it — no ids, since a card only names
 *  what the project builds. */
export interface ProjectBoardProduct {
  name: string;
  sku: string;
  revisionLabel: string;
  quantity: number;
}

/** What the board asks the API for (§6.3). `status` is never empty — the API
 *  defaults an absent one to draft + started, which would silently contradict
 *  an empty selection. The name search is not here: it filters the loaded
 *  board in the browser. */
export interface ProjectBoardQuery {
  status: ProjectStatus[];
}

// ---- Payloads -------------------------------------------------------------
//
// Same arrangement as types/products.ts: the request bodies are `import type`d
// from the backend's zod schemas so both sides describe one shape, and the
// import is fully erased at build time.

import type {
  ProjectPayload as ProjectPayloadSchema,
  ProjectProductInput as ProjectProductInputSchema,
  ProjectStatus as ProjectStatusSchema,
} from '../../../backend/src/schemas/projects.schema.ts';

export type ProjectPayload = ProjectPayloadSchema;
export type ProjectProductInput = ProjectProductInputSchema;
export type ProjectStatus = ProjectStatusSchema;

/** Display order for the board's status filter. */
export const PROJECT_STATUSES = [
  'draft',
  'started',
  'stopped',
  'completed',
] as const satisfies readonly ProjectStatus[];

/** What the board shows when the query string names no status (§6.3) —
 *  the same default the API applies to an absent `?status=`. */
export const DEFAULT_BOARD_STATUSES: ProjectStatus[] = ['draft', 'started'];
