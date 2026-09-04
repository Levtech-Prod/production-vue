// ===========================================================================
// Unit-level verification for services/projectStock.ts against seeded data —
// the acceptance check for that service, kept in the repo instead of a
// throwaway harness so a future edit that breaks the reserved/available
// logic actually gets caught.
//
// Covers the three scenarios named when this service was built:
//   - a part with no stock
//   - a part fully consumed
//   - a part claimed by two started projects, one of which is stopped
// plus three more the queries' exact predicates deserve:
//   - a started project's claim that is already fully picked (must not
//     count as reserved — the `prepared_qty < from_stock_qty + received_qty`
//     clause, not just the status filter)
//   - a project excluding its own claim from "reserved by others"
//   - getPartStock issuing exactly one round trip per call, from a single
//     snapshot, whether given the pool or an existing transaction client
//     (the shape freezeProjectBom will actually pass it)
//
// Runs against the real dev database (DATABASE_URL from .env, same as
// db:test), inside one transaction that is ALWAYS rolled back — safe to run
// repeatedly against a dev database, leaves no rows behind. Like
// database/tests/023-add-projects.test.sql, NOT safe to point at production:
// a rollback undoes the writes, but the row locks taken along the way are
// real for the duration of the run.
//
// Run:
//   npm run test:projectStock
// ===========================================================================
import { pool } from '../db.js';
import type { Queryable } from '../db.js';
import { getAvailableQuantities, getReservedQuantities, getPartStock } from './projectStock.js';

// Ids far out of the way, mirroring database/tests/023-add-projects.test.sql.
const CATEGORY_ID = 9990001;
const COMPANY_ID = 9990001;

const PART_NO_STOCK = 9990001;
const PART_FULLY_CONSUMED = 9990002;
const PART_CLAIMED_TWICE = 9990003;
const PART_FULLY_PREPARED_CLAIM = 9990004;

const PROJECT_STARTED_A = 9990001; // outstanding claim on PART_CLAIMED_TWICE
const PROJECT_STOPPED_B = 9990002; // claim on PART_CLAIMED_TWICE, but stopped
const PROJECT_STARTED_C = 9990003; // fully-prepared claim on PART_FULLY_PREPARED_CLAIM
const PROJECT_CALLER = 9990004; // the project "asking" — has no claims of its own

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${label}  actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
  if (!ok) failures++;
}

/** Wraps a Queryable and counts how many statements are sent through it. */
function countingQueryable(db: Queryable): { db: Queryable; count: () => number } {
  let calls = 0;
  return {
    db: {
      query: (text, params) => {
        calls++;
        return db.query(text as string, params as unknown[]);
      },
    },
    count: () => calls,
  };
}

async function seed(client: Queryable) {
  await client.query(`INSERT INTO part_categories (id, name) VALUES ($1, 'test-projectStock')`, [
    CATEGORY_ID,
  ]);
  await client.query(
    `INSERT INTO parts (id, category_id, name, code) VALUES
       ($1, $5, 'No stock',             'TEST-PS-NOSTOCK'),
       ($2, $5, 'Fully consumed',       'TEST-PS-CONSUMED'),
       ($3, $5, 'Claimed twice',        'TEST-PS-CLAIMED'),
       ($4, $5, 'Fully prepared claim', 'TEST-PS-PREPARED')`,
    [PART_NO_STOCK, PART_FULLY_CONSUMED, PART_CLAIMED_TWICE, PART_FULLY_PREPARED_CLAIM, CATEGORY_ID],
  );
  await client.query(`INSERT INTO companies (id, name) VALUES ($1, 'test-projectStock co')`, [
    COMPANY_ID,
  ]);

  // Fully consumed: two received rows, each drawn all the way down.
  await client.query(
    `INSERT INTO stock_entries (part_id, company_id, type, quantity, quantity_consumed, price_per_piece) VALUES
       ($1, $4, 'received', 100, 100, 1),
       ($1, $4, 'received', 30,  30,  1),
       ($2, $4, 'received', 50,  10,  1),
       ($3, $4, 'received', 20,  0,   1)`,
    [PART_FULLY_CONSUMED, PART_CLAIMED_TWICE, PART_FULLY_PREPARED_CLAIM, COMPANY_ID],
  );

  await client.query(
    `INSERT INTO projects (id, name, status) VALUES
       ($1, 'test A', 'started'),
       ($2, 'test B', 'stopped'),
       ($3, 'test C', 'started'),
       ($4, 'test caller', 'draft')`,
    [PROJECT_STARTED_A, PROJECT_STOPPED_B, PROJECT_STARTED_C, PROJECT_CALLER],
  );

  // ordered_qty / received_qty / prepared_qty are chained CHECKs (§3.3): each
  // must stay within the one before it in the SAME statement, so every
  // column between required_qty and prepared_qty is given explicitly below.
  await client.query(
    `INSERT INTO project_parts
       (project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty)
     VALUES
       ($1, $4, 15, 10, 5, 5, 5, 3),  -- A: outstanding claim on PART_CLAIMED_TWICE = 10+5-3 = 12
       ($2, $4, 20, 20, 0, 0, 0, 0),  -- B: same part, but stopped — must not count
       ($3, $5, 15, 15, 0, 0, 0, 15)`, // C: fully prepared claim on PART_FULLY_PREPARED_CLAIM — must not count
    [PROJECT_STARTED_A, PROJECT_STOPPED_B, PROJECT_STARTED_C, PART_CLAIMED_TWICE, PART_FULLY_PREPARED_CLAIM],
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed(client);

    const noStock = await getPartStock(client, [PART_NO_STOCK], PROJECT_CALLER);
    check('part with no stock: available', noStock.get(PART_NO_STOCK)?.available, 0);
    check('part with no stock: reserved', noStock.get(PART_NO_STOCK)?.reserved, 0);
    check('part with no stock: free', noStock.get(PART_NO_STOCK)?.free, 0);

    const fullyConsumed = await getPartStock(client, [PART_FULLY_CONSUMED], PROJECT_CALLER);
    check('fully consumed part: available', fullyConsumed.get(PART_FULLY_CONSUMED)?.available, 0);

    const claim = await getPartStock(client, [PART_CLAIMED_TWICE], PROJECT_CALLER);
    check('claimed by two projects (one stopped): available', claim.get(PART_CLAIMED_TWICE)?.available, 40);
    check(
      'claimed by two projects (one stopped): reserved excludes the stopped one',
      claim.get(PART_CLAIMED_TWICE)?.reserved,
      12,
    );
    check('claimed by two projects (one stopped): free', claim.get(PART_CLAIMED_TWICE)?.free, 28);

    const reservedExcludingSelf = await getReservedQuantities(client, [PART_CLAIMED_TWICE], PROJECT_STARTED_A);
    check(
      "reserved excludes the calling project's own claim",
      reservedExcludingSelf.get(PART_CLAIMED_TWICE) ?? 0,
      0,
    );

    const fullyPrepared = await getPartStock(client, [PART_FULLY_PREPARED_CLAIM], PROJECT_CALLER);
    check(
      'fully prepared started claim does not count as reserved',
      fullyPrepared.get(PART_FULLY_PREPARED_CLAIM)?.reserved,
      0,
    );
    check(
      'fully prepared started claim: available unaffected',
      fullyPrepared.get(PART_FULLY_PREPARED_CLAIM)?.available,
      20,
    );

    const batchAvailable = await getAvailableQuantities(client, [
      PART_NO_STOCK,
      PART_FULLY_CONSUMED,
      PART_CLAIMED_TWICE,
      PART_FULLY_PREPARED_CLAIM,
    ]);
    check('batch available: part with no stock is absent, not zero', batchAvailable.has(PART_NO_STOCK), false);
    check('batch available: fully consumed', batchAvailable.get(PART_FULLY_CONSUMED), 0);
    check('batch available: claimed twice', batchAvailable.get(PART_CLAIMED_TWICE), 40);
    check('batch available: fully prepared claim', batchAvailable.get(PART_FULLY_PREPARED_CLAIM), 20);

    const empty = await getAvailableQuantities(client, []);
    check('empty part id list short-circuits', empty.size, 0);

    // Round-trip counts, against the SAME transaction client freezeProjectBom
    // will actually use — not just a fresh pool connection per query.
    const partStockCounter = countingQueryable(client);
    await getPartStock(partStockCounter.db, [PART_NO_STOCK, PART_CLAIMED_TWICE, PART_CLAIMED_TWICE], PROJECT_CALLER);
    check('getPartStock issues exactly one round trip, even with duplicate ids', partStockCounter.count(), 1);

    const availableCounter = countingQueryable(client);
    await getAvailableQuantities(availableCounter.db, [PART_NO_STOCK, PART_CLAIMED_TWICE]);
    check('getAvailableQuantities issues exactly one round trip', availableCounter.count(), 1);

    const reservedCounter = countingQueryable(client);
    await getReservedQuantities(reservedCounter.db, [PART_NO_STOCK, PART_CLAIMED_TWICE], PROJECT_CALLER);
    check('getReservedQuantities issues exactly one round trip', reservedCounter.count(), 1);

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
