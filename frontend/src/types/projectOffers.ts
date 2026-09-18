// The offer sheet (projects-preparation-plan.md §3.5, §5.2, §6.5). The sheet
// IS the project's current state: companies are its columns, prices its cells,
// and there is no round or version entity behind them.
//
// Shapes mirror `backend/src/services/projectOffers.ts`. The part descriptor is
// `ProjectPartInfo` from `./projects.ts` rather than a second copy: the grid
// and the Parts table show the same part, from the same query.

import type { ProjectPartInfo, ProjectStatus } from './projects.ts';

/** One dynamic column. `id` is the `project_offer_companies` row, which is what
 *  a cell is keyed by — not the company, which can be a column of many
 *  projects at once. */
export interface OfferCompanyColumn {
  id: number;
  companyId: number;
  name: string;
  position: number;
}

/** One cell: canonical EUR, plus the provenance that says how it got there.
 *  Comparisons and totals read `pricePerPiece`; the input shows
 *  `enteredAmount`, which is what someone actually typed. */
export interface OfferPrice {
  pricePerPiece: number;
  enteredAmount: number;
  enteredCurrency: string;
  rateUsed: number | null;
  rateDate: string | null;
  updatedAt: string;
}

/** What the part actually costs, so a quote can be judged without leaving the
 *  page (§6.5). `paid` is a settled receipt, `quoted` another project's open
 *  offer — one is a fact, the other an ask. */
export interface ReferencePrice {
  pricePerPiece: number;
  company: string;
  onDate: string;
  source: 'paid' | 'quoted';
}

export interface OfferRow {
  projectPartId: number;
  part: ProjectPartInfo;
  /** `project_parts.missing_qty` — the same number the Parts table edits, not
   *  a second one (§6.5). */
  quantity: number;
  orderedQty: number;
  referencePrice: ReferencePrice | null;
  /** Keyed by `offer_company_id`; an absent key is an absent quote, which is
   *  also what an absent row means (§3.5). */
  prices: Record<number, OfferPrice>;
}

/** `GET /api/projects/:id/offer`. */
export interface OfferGrid {
  status: ProjectStatus;
  companies: OfferCompanyColumn[];
  rows: OfferRow[];
  /** RON per 1 EUR today, for showing a column of canonical-EUR prices in RON.
   *  Null when BNR could not be reached and no rate is cached, in which case
   *  RON cannot be offered — a price shown at a guessed rate is worse than a
   *  currency the page admits it cannot render. Not part of the sheet: it is
   *  today's rate, not the one any stored cell was written at. */
  ronPerEur: number | null;
}

/** One entry of the list down the left (`GET /api/projects/offer-queue`) —
 *  the board's *Offers* column, projected to what the list shows. */
export interface OfferQueueProject {
  id: number;
  name: string;
  description: string | null;
  deadline: string | null;
  createdAt: string;
  toBuyLines: number;
  onOrderLines: number;
}

/** One cell as `PUT /api/projects/:id/offer/prices` answers with it: the stored
 *  value, or null for a cell the request cleared. */
export interface OfferPriceResult {
  offerCompanyId: number;
  projectPartId: number;
  price: OfferPrice | null;
}

// The request body is `import type`d from the backend's zod schema so both
// sides describe one shape, as types/projects.ts does; the import is fully
// erased at build time.
import type { OfferPriceCell as OfferPriceCellSchema } from '../../../backend/src/schemas/projectOffers.schema.ts';

/** One edited cell. `amount: null` clears it; zero does not — a free part is a
 *  real quote and has to be distinguishable from no quote (§3.5). */
export type OfferPriceCell = OfferPriceCellSchema;
