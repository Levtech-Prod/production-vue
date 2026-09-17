// ===========================================================================
// The offer grid's two pieces of logic that hold no database between them:
// the reference-price precedence, and the payload rules the bulk price write
// leans on to stay a single statement (§3.5, §5.2).
//
// Both are here for the same reason `projectBom.unit.test.ts` is: they are
// rules, not queries, so they need no database. Everything in this module
// that DOES need one — the grid read, the bulk write, the cascade and the
// refusals — is in `projectOffers.test.ts` beside it.
//
// Run: npm run test:unit
// ===========================================================================
import { check, report, failureCount } from '../testing/check.js';
import { mergeReferencePrices, type ReferencePriceRow } from './projectOffers.js';
import { offerPricesPayloadSchema } from '../schemas/projectOffers.schema.js';

const paidRow = (partId: number, price: string): ReferencePriceRow => ({
  partId,
  pricePerPiece: price,
  onDate: '2026-03-04',
  company: 'Farnell',
});

const quotedRow = (partId: number, price: string): ReferencePriceRow => ({
  partId,
  pricePerPiece: price,
  onDate: '2026-09-01',
  company: 'TME',
});

/** The map as a sorted array, so a failure prints readably. */
function merged(paid: ReferencePriceRow[], quoted: ReferencePriceRow[]) {
  return [...mergeReferencePrices(paid, quoted).entries()]
    .sort(([a], [b]) => a - b)
    .map(([partId, ref]) => [partId, ref.source, ref.pricePerPiece, ref.company]);
}

/** What a payload does, or the message zod refused it with. */
function parsePrices(prices: unknown) {
  const result = offerPricesPayloadSchema.safeParse({ prices });
  return result.success ? result.data.prices : 'refused';
}

function main() {
  check(
    'a part that was bought reports what it cost, not what someone is asking',
    merged([paidRow(1, '0.4200')], [quotedRow(1, '0.5100')]),
    [[1, 'paid', 0.42, 'Farnell']],
  );

  check(
    'a part that was never bought falls back to another project\'s quote',
    merged([], [quotedRow(1, '0.5100')]),
    [[1, 'quoted', 0.51, 'TME']],
  );

  check(
    'the fallback fills only the parts the receipts had nothing for',
    merged([paidRow(1, '0.4200')], [quotedRow(1, '0.5100'), quotedRow(2, '1.2500')]),
    [
      [1, 'paid', 0.42, 'Farnell'],
      [2, 'quoted', 1.25, 'TME'],
    ],
  );

  check(
    'a part with neither is simply absent — the grid shows no hint rather than a zero',
    merged([paidRow(1, '0.4200')], []).length,
    1,
  );

  check(
    'a free part is a real quote: zero survives, and is not read as a cleared cell',
    parsePrices([{ offerCompanyId: 1, projectPartId: 7, amount: 0 }]),
    [{ offerCompanyId: 1, projectPartId: 7, amount: 0, currency: 'EUR' }],
  );

  check(
    'a cleared cell is null, and carries the default currency it will not use',
    parsePrices([{ offerCompanyId: 1, projectPartId: 7, amount: null }]),
    [{ offerCompanyId: 1, projectPartId: 7, amount: null, currency: 'EUR' }],
  );

  check(
    'the same cell twice is refused here rather than by the upsert, as a 500',
    parsePrices([
      { offerCompanyId: 1, projectPartId: 7, amount: 1 },
      { offerCompanyId: 1, projectPartId: 7, amount: 2 },
    ]),
    'refused',
  );

  check(
    'one company quoting two parts is not a duplicate',
    parsePrices([
      { offerCompanyId: 1, projectPartId: 7, amount: 1, currency: 'RON' },
      { offerCompanyId: 1, projectPartId: 8, amount: 2, currency: 'RON' },
    ]).length,
    2,
  );

  check(
    'two companies quoting one part are not a duplicate either',
    parsePrices([
      { offerCompanyId: 1, projectPartId: 7, amount: 1 },
      { offerCompanyId: 2, projectPartId: 7, amount: 2 },
    ]).length,
    2,
  );

  check(
    'a negative price is refused',
    parsePrices([{ offerCompanyId: 1, projectPartId: 7, amount: -1 }]),
    'refused',
  );

  check(
    'a price past NUMERIC(12,4) is refused here, not as a 22003 from the insert',
    parsePrices([{ offerCompanyId: 1, projectPartId: 7, amount: 1e8 }]),
    'refused',
  );

  check('an empty batch is refused — there is nothing to write', parsePrices([]), 'refused');

  report();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main();
