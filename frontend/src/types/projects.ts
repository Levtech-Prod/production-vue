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

// ---- Parts table ------------------------------------------------------------
//
// `GET /api/projects/:id/parts` (plan §5.4). One shape for both a draft's
// live-computed rows and a started project's frozen ones — `draft` on the
// payload is the only thing that tells them apart.

export interface ProjectPartInfo {
  id: number;
  name: string;
  code: string;
  image: string | null;
  categoryId: number;
  categoryName: string;
}

/** One product this part is used by, collapsed from however many sub-product
 *  usages it has there — see `qtyForProduct` below. */
export interface ProjectPartRowProduct {
  projectProductId: number;
  productId: number;
  sku: string;
  revisionLabel: string;
  /** Per one unit of the product. */
  qtyPerUnit: number;
  /** `qtyPerUnit x that product's project quantity` — the products across a
   *  row always sum to `requiredQty`. */
  qtyForProduct: number;
}

/** One row of the Parts table. */
export interface ProjectPartRow {
  /** `project_parts.id`, or null while the project is a draft and the row is
   *  computed rather than stored. Rows are keyed on `part.id`, which both
   *  forms have. */
  id: number | null;
  part: ProjectPartInfo;
  products: ProjectPartRowProduct[];
  requiredQty: number;
  availableQty: number;
  reservedQty: number;
  fromStockQty: number;
  missingQty: number;
  missingQtyOverridden: boolean;
  orderedQty: number;
  receivedQty: number;
  preparedQty: number;
  toBuyQty: number;
  onOrderQty: number;
  toPickQty: number;
  /** Someone has taken stock this project was counting on (plan §4.2). */
  stockShortfall: boolean;
}

export interface ProjectPartsPayload {
  draft: boolean;
  rows: ProjectPartRow[];
}

/** `POST /api/projects/:id/parts/recalculate` (§5.2/§5.3). */
export interface ProjectPartsRecalculateResult {
  changed: ProjectPartRow[];
  skipped: ProjectPartRow[];
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
  ProjectPartUpdateInput as ProjectPartUpdateInputSchema,
} from '../../../backend/src/schemas/projects.schema.ts';

export type ProjectPayload = ProjectPayloadSchema;
export type ProjectProductInput = ProjectProductInputSchema;
export type ProjectStatus = ProjectStatusSchema;
/** `PATCH /api/projects/:id/parts/:projectPartId` (§5.2). */
export type ProjectPartUpdate = ProjectPartUpdateInputSchema;

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
