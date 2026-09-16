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
  /** Every sub-product the frozen BOM mentions, across all the products above.
   *  Empty until the project is started. One *Preparation* card each. */
  subProducts: ProjectBoardSubProduct[];
  toBuyLines: number;
  onOrderLines: number;
  inOffers: boolean;
  inOrdered: boolean;
  inPreparation: boolean;
  inPrepared: boolean;
}

/** One product line as the board shows it. */
export interface ProjectBoardProduct {
  projectProductId: number;
  name: string;
  sku: string;
  revisionLabel: string;
  quantity: number;
  /** Sub-products of this product in this project, and how many are prepared.
   *  The same fraction twice over: the progress bar on each of its
   *  *Preparation* cards, and the percentage beside it on the *Prepared*
   *  card. */
  subProductCount: number;
  preparedSubProducts: number;
}

/** One sub-product of one pinned product — a *Preparation* card, and a line
 *  under its product on the *Prepared* card. Preparation is done one of these
 *  at a time, which is why the board splits them out. */
export interface ProjectBoardSubProduct {
  projectProductId: number;
  subProductRevisionId: number;
  name: string;
  sku: string | null;
  revisionLabel: string;
  /** Distinct parts this sub-product needs, frozen at Start. */
  partCount: number;
  /** How many of those the project already holds enough of. */
  readyPartCount: number;
  /** Pieces across every line: what the sub-product needs, and what is already
   *  in its box. Quantities rather than finished lines, so the card moves when
   *  someone pulls 2 of the 5 a line needs — and since no line may hold more
   *  than it needs, the two being equal is also what enables "Mark prepared". */
  requiredQty: number;
  pickedQty: number;
  prepared: boolean;
  /** Whether this sub-product belongs in the *Preparation* column — the
   *  server's call, not the board's. */
  inPreparation: boolean;
}

/** One pick-list line's three quantities, as any write to it answers. */
export interface ProjectPartPickState {
  /** `project_part_usages.id` — the row the picked quantity is stored on. */
  usageId: number;
  /** What this sub-product needs, across the product's project quantity. */
  requiredQty: number;
  /** How much of it is already in the job box. */
  pickedQty: number;
  /** The most this line could be picked to right now: what is in the box plus
   *  what the project still holds unpicked, capped at what the line needs.
   *  Counted per part for the whole project, so two sub-products sharing a
   *  scarce part are looking at the same pile. */
  onHandQty: number;
}

/** One line of a sub-product's pick list, as its modal shows it. */
export interface ProjectSubProductPart extends ProjectPartPickState {
  partId: number;
  name: string;
  code: string;
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
  /** Free stock: what is on the shelf minus what other started projects have
   *  claimed. Unclamped, so it can be negative when a stale claim outruns the
   *  shelf (§4.2) — which is why the table heads it "Free stock" rather than
   *  "Available". */
  freeQty: number;
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

// ---- Write results ---------------------------------------------------------
//
// Every write that can move a project between the board's columns answers with
// the one card it changed. The board patches that card in place instead of
// refetching all of them, and the membership rule stays on the server where
// decision 2 puts it — the card is the server's answer, not a rule the browser
// re-applies.

export interface WithBoardCard {
  card: ProjectBoardCard;
}

/** `POST /api/projects`, `PATCH /api/projects/:id`, Start and Stop. */
export interface ProjectWriteResult extends WithBoardCard {
  project: Project;
}

/** `PATCH /api/projects/:id/parts/:projectPartId` — the row as the table
 *  should now show it, so the caller patches instead of reloading. */
export interface ProjectPartUpdateResult extends WithBoardCard {
  row: ProjectPartRow;
}

/** `POST /api/projects/:id/parts/recalculate` (§5.2/§5.3). */
export interface ProjectPartsRecalculateResult extends WithBoardCard {
  changed: ProjectPartRow[];
  skipped: ProjectPartRow[];
}

/** `PATCH /api/projects/:id/preparations/:a/:b/picks` — the whole pick list as
 *  it now stands, not only the lines written: taking from a shared part moves
 *  what its siblings can still be filled to. */
export interface SubProductPicksResult extends WithBoardCard {
  parts: ProjectPartPickState[];
}

/** `POST`/`DELETE /api/projects/:id/preparations/...`. */
export interface SubProductPreparationResult extends WithBoardCard {
  projectProductId: number;
  subProductRevisionId: number;
  prepared: boolean;
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
  ProjectPartPick as ProjectPartPickSchema,
  ProjectSubProductRef as ProjectSubProductRefSchema,
} from '../../../backend/src/schemas/projects.schema.ts';

export type ProjectPayload = ProjectPayloadSchema;
export type ProjectProductInput = ProjectProductInputSchema;
export type ProjectStatus = ProjectStatusSchema;
/** `PATCH /api/projects/:id/parts/:projectPartId` (§5.2). */
export type ProjectPartUpdate = ProjectPartUpdateInputSchema;
/** Which sub-product a preparation write is about. */
export type ProjectSubProductRef = ProjectSubProductRefSchema;
/** One line of a pick request: the absolute quantity now in the job box. */
export type ProjectPartPick = ProjectPartPickSchema;

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
