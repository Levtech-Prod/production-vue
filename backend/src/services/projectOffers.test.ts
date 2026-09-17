// ===========================================================================
// Verification for services/projectOffers.ts against seeded data.
//
// `projectOffers.unit.test.ts` covers the two rules that need no database.
// Everything here is the part that can actually put a wrong number in front of
// a buyer, and none of it is reachable without one:
//
//   - THE EIGHT POSITIONAL ARRAYS. The bulk upsert feeds an eight-column
//     INSERT from eight `unnest` arrays paired by position alone. A ninth
//     column added without its array shifts every value one place left, and
//     nothing but a real write and a read-back can see it. So every column of
//     a written row is asserted, including the RON provenance — the columns a
//     currency dispute is settled from.
//   - ZERO IS A PRICE, NULL IS NOT. A free part must survive the round trip as
//     0, a cleared cell must delete its row, and a NULL price must not reach
//     the grid as 0 — three spellings of one rule (§3.5) that a single
//     `Number(null)` collapses into each other.
//   - THE GRID'S MEMBERSHIP. A fully ordered line leaves the grid, and its
//     quantity is the whole `missing_qty`, not the outstanding remainder.
//   - THE REFERENCE PRICE. Paid beats quoted, the newest receipt beats an
//     older one, and this project's own quotes are never its own hint.
//   - THE REFUSALS, each as its own code rather than a raw 23503 or 23505.
//   - THE CASCADE. Dropping a column takes its prices with it, which is the
//     composite FK doing the work no service check would.
//
// Not covered here: `convertOfferCells`, which would reach bnr.ro. Its
// mapping is by name, not position, and the columns it feeds are asserted
// below from hand-built cells.
//
// Runs against the real dev database (DATABASE_URL from .env, same as
// db:test), inside one transaction that is ALWAYS rolled back — safe to run
// repeatedly, leaves no rows behind. Like database/tests/023-add-projects.test.sql,
// NOT safe to point at production: a rollback undoes the writes, but the row
// locks taken along the way are real for the duration of the run.
//
// Run:
//   npm run test:projectOffers
// ===========================================================================
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report, failureCount } from '../testing/check.js';
import {
  addOfferCompany,
  loadOfferGrid,
  removeOfferCompany,
  writeOfferPrices,
  type ConvertedOfferCell,
} from './projectOffers.js';
import type { OfferPriceCell } from '../schemas/projectOffers.schema.js';

// Ids far out of the way, mirroring database/tests/023-add-projects.test.sql.
const CATEGORY_ID = 9960001;
const PART_BOUGHT = 9960001; // has a receipt — its hint must be the paid price
const PART_QUOTED = 9960002; // never bought, quoted by the other project
const PART_DONE = 9960003; // fully ordered — must not be on the grid at all

const COMPANY_A = 9960001;
const COMPANY_B = 9960002;
const COMPANY_OTHER = 9960003;

const PROJECT_ID = 9960001;
const OTHER_PROJECT_ID = 9960002;

const PP_BOUGHT = 9960001;
const PP_QUOTED = 9960002;
const PP_DONE = 9960003;
const PP_OTHER_BOUGHT = 9960004; // the other project's line for PART_BOUGHT
const PP_OTHER_QUOTED = 9960005;

const OTHER_COLUMN = 9960001; // the other project's only offer column

async function seed(client: PoolClient) {
  await client.query(`INSERT INTO part_categories (id, name) VALUES ($1, 'test-projectOffers')`, [
    CATEGORY_ID,
  ]);
  await client.query(
    `INSERT INTO parts (id, category_id, name, code) VALUES
       ($1, $4, 'Relay 5V',  'TEST-PO-RELAY'),
       ($2, $4, 'Cap 100n',  'TEST-PO-CAP'),
       ($3, $4, 'Res 10k',   'TEST-PO-RES')`,
    [PART_BOUGHT, PART_QUOTED, PART_DONE, CATEGORY_ID],
  );
  await client.query(
    `INSERT INTO companies (id, name) VALUES
       ($1, 'TEST-PO Farnell'), ($2, 'TEST-PO TME'), ($3, 'TEST-PO Mouser')`,
    [COMPANY_A, COMPANY_B, COMPANY_OTHER],
  );
  await client.query(
    `INSERT INTO projects (id, name, status, started_at) VALUES
       ($1, 'test offers', 'started', NOW()),
       ($2, 'test offers other', 'started', NOW())`,
    [PROJECT_ID, OTHER_PROJECT_ID],
  );

  // PART_DONE is ordered out: missing_qty = ordered_qty, so it has nothing
  // left to buy and must not appear on the grid.
  await client.query(
    `INSERT INTO project_parts
       (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty) VALUES
       ($1, $6, $4, 100, 0, 100, 0),
       ($2, $6, $5, 50,  0, 50,  20),
       ($3, $6, $7, 10,  0, 10,  10)`,
    [PP_BOUGHT, PP_QUOTED, PP_DONE, PART_BOUGHT, PART_QUOTED, PROJECT_ID, PART_DONE],
  );
  await client.query(
    `INSERT INTO project_parts
       (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty) VALUES
       ($1, $3, $4, 7, 0, 7, 0),
       ($2, $3, $5, 5, 0, 5, 0)`,
    [PP_OTHER_BOUGHT, PP_OTHER_QUOTED, OTHER_PROJECT_ID, PART_BOUGHT, PART_QUOTED],
  );

  // Two receipts for PART_BOUGHT: the hint must be the NEWER one, not the
  // cheaper or the first.
  await client.query(
    `INSERT INTO stock_entries (type, part_id, company_id, quantity, price_per_piece, entered_at)
     VALUES ('received', $1, $2, 10, 0.5000, NOW() - INTERVAL '30 days'),
            ('received', $1, $2, 10, 0.4200, NOW() - INTERVAL '2 days')`,
    [PART_BOUGHT, COMPANY_A],
  );

  // The other project quotes BOTH parts. Only PART_QUOTED's quote can surface
  // as a hint here: PART_BOUGHT has a receipt, which outranks it.
  await client.query(
    `INSERT INTO project_offer_companies (id, project_id, company_id, position)
     VALUES ($1, $2, $3, 0)`,
    [OTHER_COLUMN, OTHER_PROJECT_ID, COMPANY_OTHER],
  );
  await client.query(
    `INSERT INTO project_offer_prices
       (project_id, offer_company_id, project_part_id, price_per_piece, entered_amount)
     VALUES ($1, $2, $3, 0.9900, 0.9900), ($1, $2, $4, 0.1900, 0.1900)`,
    [OTHER_PROJECT_ID, OTHER_COLUMN, PP_OTHER_BOUGHT, PP_OTHER_QUOTED],
  );
}

const eurCell = (
  offerCompanyId: number,
  projectPartId: number,
  amount: number,
): ConvertedOfferCell => ({
  offerCompanyId,
  projectPartId,
  amount,
  currency: 'EUR',
  priceEur: amount,
  rateUsed: null,
  rateDate: null,
});

/** A RON cell as `convertOfferCells` would hand it over at 5.0 RON/EUR. */
const ronCell = (
  offerCompanyId: number,
  projectPartId: number,
  amount: number,
): ConvertedOfferCell => ({
  offerCompanyId,
  projectPartId,
  amount,
  currency: 'RON',
  priceEur: Number((amount / 5).toFixed(4)),
  rateUsed: 5,
  rateDate: '2026-09-17',
});

const asRequest = (cells: ConvertedOfferCell[]): OfferPriceCell[] =>
  cells.map(({ offerCompanyId, projectPartId, amount, currency }) => ({
    offerCompanyId,
    projectPartId,
    amount,
    currency,
  }));

const clearCell = (offerCompanyId: number, projectPartId: number): OfferPriceCell => ({
  offerCompanyId,
  projectPartId,
  amount: null,
  currency: 'EUR',
});

/** Every stored column of one cell, straight from the table. */
async function storedCell(client: PoolClient, offerCompanyId: number, projectPartId: number) {
  const result = await client.query(
    `SELECT project_id, price_per_piece, entered_amount, entered_currency,
       rate_used, to_char(rate_date, 'YYYY-MM-DD') AS rate_date
     FROM project_offer_prices
     WHERE offer_company_id = $1 AND project_part_id = $2`,
    [offerCompanyId, projectPartId],
  );
  const row = result.rows[0];
  return row
    ? [
        Number(row.project_id),
        Number(row.price_per_piece),
        Number(row.entered_amount),
        row.entered_currency,
        row.rate_used === null ? null : Number(row.rate_used),
        row.rate_date,
      ]
    : null;
}

/**
 * `checkRefuses` around a call that may reach a constraint.
 *
 * A unique or FK violation aborts the whole transaction, so without the
 * savepoint the first expected refusal takes every later check down with it
 * as a 25P02. This is not the test papering over the service: in production
 * each of these calls is the only thing inside `withTransaction`, which
 * throws the ApiError onward and rolls the transaction back exactly as
 * Postgres already has. The savepoint is what lets one test session make
 * several of those attempts in a row.
 */
async function checkRefusesHere(
  client: PoolClient,
  label: string,
  fn: () => unknown,
  status: number,
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes],
): Promise<void> {
  await client.query('SAVEPOINT refusal');
  await checkRefuses(label, fn, status, code);
  await client.query('ROLLBACK TO SAVEPOINT refusal');
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed(client);

    // --- the grid, before anything is quoted ------------------------------
    const empty = await loadOfferGrid(client, PROJECT_ID, 'started');
    check(
      'a fully ordered line is off the grid; the rest carry the whole missing_qty',
      empty.rows.map((row) => [row.part.code, row.quantity, row.orderedQty]),
      [
        ['TEST-PO-CAP', 50, 20],
        ['TEST-PO-RELAY', 100, 0],
      ],
    );
    check(
      'a bought part is hinted at what we paid, newest receipt first',
      empty.rows
        .filter((row) => row.part.code === 'TEST-PO-RELAY')
        .map((row) => [row.referencePrice?.source, row.referencePrice?.pricePerPiece]),
      [['paid', 0.42]],
    );
    check(
      "a never-bought part falls back to the other project's quote, not to this one's",
      empty.rows
        .filter((row) => row.part.code === 'TEST-PO-CAP')
        .map((row) => [row.referencePrice?.source, row.referencePrice?.pricePerPiece]),
      [['quoted', 0.19]],
    );
    check('no columns yet, so no cells', [empty.companies.length, empty.rows[0].prices], [0, {}]);

    // --- columns ----------------------------------------------------------
    const columnA = await addOfferCompany(client, PROJECT_ID, COMPANY_A);
    const columnB = await addOfferCompany(client, PROJECT_ID, COMPANY_B);
    check(
      'columns take the next position and answer with the company name',
      [
        [columnA.companyId, columnA.position, columnA.name],
        [columnB.companyId, columnB.position, columnB.name],
      ],
      [
        [COMPANY_A, 0, 'TEST-PO Farnell'],
        [COMPANY_B, 1, 'TEST-PO TME'],
      ],
    );
    await checkRefusesHere(
      client,
      'the same company twice is one column',
      () => addOfferCompany(client, PROJECT_ID, COMPANY_A),
      409,
      ErrorCodes.OFFER_COMPANY_ALREADY_ADDED,
    );
    await checkRefusesHere(
      client,
      'a company that does not exist is a 404, not a raw 23503',
      () => addOfferCompany(client, PROJECT_ID, 9969999),
      404,
      ErrorCodes.COMPANY_NOT_FOUND,
    );

    // --- the write: every column of it ------------------------------------
    const ron = ronCell(columnA.id, PP_BOUGHT, 2.05);
    const free = eurCell(columnA.id, PP_QUOTED, 0);
    const batch = [ron, free];
    const written = await writeOfferPrices(client, PROJECT_ID, asRequest(batch), batch);
    check(
      'a whole column round-trips in one call, canonical EUR back',
      written
        .map((cell) => [cell.projectPartId, cell.price?.pricePerPiece])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
      [
        [PP_BOUGHT, 0.41],
        [PP_QUOTED, 0],
      ],
    );
    check(
      'a RON price stores EUR plus the rate it was converted at, column for column',
      await storedCell(client, columnA.id, PP_BOUGHT),
      [PROJECT_ID, 0.41, 2.05, 'RON', 5, '2026-09-17'],
    );
    check(
      'a EUR price records no rate, and zero is stored as a real price',
      await storedCell(client, columnA.id, PP_QUOTED),
      [PROJECT_ID, 0, 0, 'EUR', null, null],
    );
    check(
      'a free part reaches the grid as 0, not as an absent quote',
      (await loadOfferGrid(client, PROJECT_ID, 'started')).rows
        .filter((row) => row.projectPartId === PP_QUOTED)
        .map((row) => row.prices[columnA.id]?.pricePerPiece),
      [0],
    );

    // --- re-writing and clearing ------------------------------------------
    const raised = [eurCell(columnA.id, PP_BOUGHT, 0.39)];
    await writeOfferPrices(client, PROJECT_ID, asRequest(raised), raised);
    check(
      're-sending a cell replaces it in place, rate provenance and all',
      await storedCell(client, columnA.id, PP_BOUGHT),
      [PROJECT_ID, 0.39, 0.39, 'EUR', null, null],
    );
    check(
      'and does not leave a second row behind',
      (
        await client.query(`SELECT COUNT(*)::int AS n FROM project_offer_prices WHERE project_id = $1`, [
          PROJECT_ID,
        ])
      ).rows[0].n,
      2,
    );

    const mixed = [eurCell(columnB.id, PP_BOUGHT, 0.44)];
    const mixedRequest = [...asRequest(mixed), clearCell(columnA.id, PP_QUOTED)];
    const mixedResult = await writeOfferPrices(client, PROJECT_ID, mixedRequest, mixed);
    check(
      'one request can fill one cell and blank another, and says so for both',
      mixedResult.map((cell) => [cell.offerCompanyId, cell.projectPartId, cell.price === null]),
      [
        [columnA.id, PP_QUOTED, true],
        [columnB.id, PP_BOUGHT, false],
      ],
    );
    check(
      'a cleared cell deletes its row rather than storing a NULL',
      await storedCell(client, columnA.id, PP_QUOTED),
      null,
    );

    // A NULL price cannot be written through this service, but the column
    // allows one (§3.5) — and Number(null) is 0, so a grid that did not filter
    // it would hand the order to a company that never quoted.
    await client.query(
      `INSERT INTO project_offer_prices (project_id, offer_company_id, project_part_id)
       VALUES ($1, $2, $3)`,
      [PROJECT_ID, columnB.id, PP_QUOTED],
    );
    check(
      'a NULL price is no quote, not a free part',
      (await loadOfferGrid(client, PROJECT_ID, 'started')).rows
        .filter((row) => row.projectPartId === PP_QUOTED)
        .map((row) => Object.keys(row.prices).length),
      [0],
    );
    await client.query(
      `DELETE FROM project_offer_prices
       WHERE offer_company_id = $1 AND project_part_id = $2`,
      [columnB.id, PP_QUOTED],
    );

    // --- refusals a stale grid runs into ----------------------------------
    await checkRefusesHere(
      client,
      "writing into another project's column is a 404, not a raw FK violation",
      () => {
        const foreign = [eurCell(OTHER_COLUMN, PP_BOUGHT, 1)];
        return writeOfferPrices(client, PROJECT_ID, asRequest(foreign), foreign);
      },
      404,
      ErrorCodes.OFFER_COMPANY_NOT_FOUND,
    );
    await checkRefusesHere(
      client,
      "writing against another project's part is a 404 too",
      () => {
        const foreign = [eurCell(columnA.id, PP_OTHER_BOUGHT, 1)];
        return writeOfferPrices(client, PROJECT_ID, asRequest(foreign), foreign);
      },
      404,
      ErrorCodes.PROJECT_PART_NOT_FOUND,
    );
    check(
      'and a refused batch wrote nothing',
      (
        await client.query(`SELECT COUNT(*)::int AS n FROM project_offer_prices WHERE project_id = $1`, [
          PROJECT_ID,
        ])
      ).rows[0].n,
      2,
    );

    // --- dropping a column -------------------------------------------------
    await checkRefusesHere(
      client,
      'a column of another project is not this one\'s to remove',
      () => removeOfferCompany(client, PROJECT_ID, OTHER_COLUMN),
      404,
      ErrorCodes.OFFER_COMPANY_NOT_FOUND,
    );

    await removeOfferCompany(client, PROJECT_ID, columnB.id);
    check(
      'dropping a column takes its prices with it',
      (
        await client.query(
          `SELECT COUNT(*)::int AS n FROM project_offer_prices WHERE offer_company_id = $1`,
          [columnB.id],
        )
      ).rows[0].n,
      0,
    );
    check(
      "and leaves the other column's cells alone",
      await storedCell(client, columnA.id, PP_BOUGHT),
      [PROJECT_ID, 0.39, 0.39, 'EUR', null, null],
    );

    await client.query(`INSERT INTO orders (project_id, company_id) VALUES ($1, $2)`, [
      PROJECT_ID,
      COMPANY_A,
    ]);
    await checkRefusesHere(
      client,
      'a company parts were ordered from cannot lose its column',
      () => removeOfferCompany(client, PROJECT_ID, columnA.id),
      409,
      ErrorCodes.OFFER_COMPANY_IN_USE,
    );
    check(
      'and the refusal left the quotes behind it intact',
      await storedCell(client, columnA.id, PP_BOUGHT),
      [PROJECT_ID, 0.39, 0.39, 'EUR', null, null],
    );

    // --- this project's own quotes are not its own hint --------------------
    check(
      'a part quoted only inside this project still has no reference price',
      (await loadOfferGrid(client, PROJECT_ID, 'started')).rows
        .filter((row) => row.projectPartId === PP_BOUGHT)
        .map((row) => row.referencePrice?.source),
      ['paid'],
    );

    report();
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
