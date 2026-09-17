// The offer grid's request bodies (projects-preparation-plan.md §3.5, §5.2).
// Companies are the grid's columns, prices its cells; nothing here describes
// an "offer round", because there isn't one.
import { z } from 'zod';
import { pgIntSchema } from './projects.schema.js';
import { entryCurrencySchema } from './money.schema.js';

/** `POST /api/projects/:id/offer/companies` — one new column. */
export const offerCompanyInputSchema = z.object({ companyId: pgIntSchema() });
export type OfferCompanyInput = z.infer<typeof offerCompanyInputSchema>;

// `project_offer_prices.price_per_piece` is NUMERIC(12,4). Anything at or past
// 1e8 overflows it with a raw 22003 — the same trap POSTGRES_INT_MAX covers
// for the id columns, and a live one here: a pasted spreadsheet column is the
// one place a price arrives without a human having looked at it.
const MAX_PRICE_PER_PIECE = 99_999_999.9999;

/**
 * One cell. `amount: null` clears it — the row is deleted, because a missing
 * row and a NULL price mean the same thing (§3.5). Zero does NOT clear it:
 * a free part is a real quote and has to be distinguishable from no quote.
 */
export const offerPriceCellSchema = z.object({
  offerCompanyId: pgIntSchema(),
  projectPartId: pgIntSchema(),
  amount: z.number().nonnegative().max(MAX_PRICE_PER_PIECE).nullable(),
  currency: entryCurrencySchema.default('EUR'),
});
export type OfferPriceCell = z.infer<typeof offerPriceCellSchema>;

/**
 * The most cells one request may carry. A sanity bound on one statement, not a
 * business rule: §6.5's clipboard import writes one company's column at once.
 *
 * Exported because the cap is all-or-nothing — over it the whole batch is
 * refused and NOTHING is written — so a client that flushes every dirty cell
 * at once (several columns on a large project) has to chunk to this size
 * rather than discover the limit by losing an afternoon of typing. The 422
 * also carries zod's `maximum`, which `server.ts` forwards, so a client that
 * did not chunk can still read the number back off the refusal.
 */
export const MAX_OFFER_PRICE_CELLS = 1000;

/**
 * `PUT /api/projects/:id/offer/prices` — a whole edited column in one request
 * (§5.2). Wrapped in an object rather than sent as a bare array, matching
 * `projectPartPicksSchema`, the other bulk write in this module.
 */
export const offerPricesPayloadSchema = z.object({
  prices: z
    .array(offerPriceCellSchema)
    .min(1)
    .max(MAX_OFFER_PRICE_CELLS)
    // The upsert writes the batch in one statement, and Postgres refuses an
    // ON CONFLICT that would touch the same row twice ("cannot affect row a
    // second time", 21000) — a 500 for what is plainly a bad request.
    .refine(
      (cells) => new Set(cells.map((c) => `${c.offerCompanyId}:${c.projectPartId}`)).size === cells.length,
      { message: 'The same cell appears twice' },
    ),
});
export type OfferPricesPayload = z.input<typeof offerPricesPayloadSchema>;
