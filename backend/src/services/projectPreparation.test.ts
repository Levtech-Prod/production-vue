// ===========================================================================
// Verification for services/projectPreparation.ts against seeded data.
//
// `projectPreparation.unit.test.ts` covers the arithmetic; everything that can
// actually corrupt data is here, because none of it is reachable without a
// database:
//
//   - THE LEDGER. `project_parts.prepared_qty` is the sum of
//     `project_part_usages.picked_qty` across that part's lines, written in the
//     same transaction. Nothing enforces that but the code, and once the two
//     drift no later edit unwinds it: the picked quantity is written
//     absolutely while only the difference is applied to the sum. Every
//     mutation below is followed by a check that they still agree.
//   - THE SHARED PILE. One part used by two sub-products is ONE project_parts
//     row, so picking for the first has to lower what the second can take —
//     the case a per-line ceiling cannot see.
//   - THE REFUSALS, each as its own code rather than as a raw 23514 from
//     `chk_project_parts_prepared_within_pickable`.
//   - THE BOARD AGGREGATE, whose five FILTERed counts decide whether a card
//     appears at all, and which a swapped comparison would flip silently.
//   - THE ROUND TRIPS. Filling a pick list is one request; it must stay a
//     fixed number of statements however many lines it carries.
//
// Runs against the real dev database (DATABASE_URL from .env, same as
// db:test), inside one transaction that is ALWAYS rolled back — safe to run
// repeatedly against a dev database, leaves no rows behind. Like
// database/tests/023-add-projects.test.sql, NOT safe to point at production:
// a rollback undoes the writes, but the row locks taken along the way are
// real for the duration of the run.
//
// Run:
//   npm run test:projectPreparation
// ===========================================================================
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report, failureCount } from '../testing/check.js';
import {
  applySubProductPicks,
  loadBoardSubProducts,
  loadSubProductParts,
  markSubProductPrepared,
  unmarkSubProductPrepared,
} from './projectPreparation.js';

// Ids far out of the way, mirroring database/tests/023-add-projects.test.sql.
const CATEGORY_ID = 9970001;
const PART_SHARED = 9970001; // used by BOTH sub-products — one project_parts row
const PART_SOLO = 9970002;

const PRODUCT_ID = 9970001;
const PRODUCT_REVISION_ID = 9970001;
const SUB_PRODUCT_A = 9970001;
const SUB_PRODUCT_B = 9970002;
const SPR_A = 9970001;
const SPR_B = 9970002;

const PROJECT_ID = 9970001;
const PPROD_ID = 9970001; // the product pinned to the project, quantity 2

const PP_SHARED = 9970001; // project_parts row for PART_SHARED
const PP_SOLO = 9970002;

// One usage row per (part, sub-product). `project_part_usages` is unique on
// (project_part_id, project_product_id, sub_product_revision_id), so a part
// appears at most once per sub-product — which is why the shared pile is only
// ever contended ACROSS sub-products, never within one list.
const U_A_SHARED = 9970001; // A needs 2 x 2 = 4 of PART_SHARED
const U_A_SOLO = 9970002; //   A needs 3 x 2 = 6 of PART_SOLO
const U_B_SHARED = 9970003; // B needs 1 x 2 = 2 of PART_SHARED

const REF_A = { projectProductId: PPROD_ID, subProductRevisionId: SPR_A };
const REF_B = { projectProductId: PPROD_ID, subProductRevisionId: SPR_B };

async function seed(client: PoolClient) {
  await client.query(`INSERT INTO part_categories (id, name) VALUES ($1, 'test-projectPrep')`, [
    CATEGORY_ID,
  ]);
  await client.query(
    `INSERT INTO parts (id, category_id, name, code) VALUES
       ($1, $3, 'Shared bracket', 'TEST-PP-SHARED'),
       ($2, $3, 'Solo gasket',    'TEST-PP-SOLO')`,
    [PART_SHARED, PART_SOLO, CATEGORY_ID],
  );

  // products.type and sub_products.type are each an FK to their own type
  // table (schema.sql, "Backfill" block) — both are needed, and ON CONFLICT
  // because a dev database may already carry either name.
  await client.query(`INSERT INTO product_types (name) VALUES ('t-prep') ON CONFLICT DO NOTHING`);
  await client.query(
    `INSERT INTO sub_product_types (name) VALUES ('t-prep') ON CONFLICT DO NOTHING`,
  );
  await client.query(
    `INSERT INTO products (id, name, sku, type) VALUES ($1, 'Prep rig', 'TEST-PP-RIG', 't-prep')`,
    [PRODUCT_ID],
  );
  await client.query(
    `INSERT INTO product_revisions (id, product_id, revision_number, label)
     VALUES ($1, $2, 1, 'Rev. 1')`,
    [PRODUCT_REVISION_ID, PRODUCT_ID],
  );
  await client.query(
    `INSERT INTO sub_products (id, product_id, name, sku, type) VALUES
       ($1, $3, 'Frame', 'TEST-PP-FRAME', 't-prep'),
       ($2, $3, 'Lid',   'TEST-PP-LID',   't-prep')`,
    [SUB_PRODUCT_A, SUB_PRODUCT_B, PRODUCT_ID],
  );
  await client.query(
    `INSERT INTO sub_product_revisions (id, sub_product_id, revision_number, label) VALUES
       ($1, $3, 1, 'A'),
       ($2, $4, 1, 'B')`,
    [SPR_A, SPR_B, SUB_PRODUCT_A, SUB_PRODUCT_B],
  );

  await client.query(`INSERT INTO projects (id, name, status) VALUES ($1, 'test prep', 'started')`, [
    PROJECT_ID,
  ]);
  await client.query(
    `INSERT INTO project_products (id, project_id, product_id, product_revision_id, quantity, position)
     VALUES ($1, $2, $3, $4, 2, 0)`,
    [PPROD_ID, PROJECT_ID, PRODUCT_ID, PRODUCT_REVISION_ID],
  );

  // The project holds 5 of the shared part against a requirement of 6, which
  // is what makes the two sub-products compete for it; the solo part is
  // covered in full. ordered/received/prepared are chained CHECKs (§3.3), so
  // every column is given explicitly.
  await client.query(
    `INSERT INTO project_parts
       (id, project_id, part_id, required_qty, from_stock_qty, missing_qty, ordered_qty, received_qty, prepared_qty)
     VALUES
       ($1, $3, $4, 6, 5, 1, 0, 0, 0),
       ($2, $3, $5, 6, 6, 0, 0, 0, 0)`,
    [PP_SHARED, PP_SOLO, PROJECT_ID, PART_SHARED, PART_SOLO],
  );
  await client.query(
    `INSERT INTO project_part_usages
       (id, project_part_id, project_product_id, sub_product_revision_id, qty_per_unit, picked_qty)
     VALUES
       ($1, $4, $6, $7, 2, 0),
       ($2, $5, $6, $7, 3, 0),
       ($3, $4, $6, $8, 1, 0)`,
    [U_A_SHARED, U_A_SOLO, U_B_SHARED, PP_SHARED, PP_SOLO, PPROD_ID, SPR_A, SPR_B],
  );
}

/** The invariant the whole scheme rests on, asserted after every write. */
async function checkLedger(client: PoolClient, label: string) {
  const result = await client.query<{ id: number; preparedQty: number; picked: number }>(
    `SELECT pp.id, pp.prepared_qty AS "preparedQty",
            COALESCE(SUM(ppu.picked_qty), 0)::int AS picked
       FROM project_parts pp
       LEFT JOIN project_part_usages ppu ON ppu.project_part_id = pp.id
      WHERE pp.project_id = $1
      GROUP BY pp.id
      ORDER BY pp.id`,
    [PROJECT_ID],
  );
  check(
    `${label}: prepared_qty is the sum of its picks`,
    result.rows.map((r) => r.preparedQty),
    result.rows.map((r) => r.picked),
  );
}

async function pickedOf(client: PoolClient, ref: typeof REF_A) {
  const parts = await loadSubProductParts(client, PROJECT_ID, ref);
  return parts.map((p) => [p.usageId, p.pickedQty, p.onHandQty]);
}

/** Wraps a client and counts the statements sent through it, to pin that one
 *  batch stays a fixed number of round trips however many lines it carries. */
function countingClient(client: PoolClient): { client: PoolClient; count: () => number } {
  let calls = 0;
  const wrapper = {
    query: (text: unknown, params: unknown) => {
      calls++;
      return client.query(text as string, params as unknown[]);
    },
  };
  return { client: wrapper as unknown as PoolClient, count: () => calls };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed(client);

    // --- the batch, and the pile it draws on ------------------------------
    const filledA = await applySubProductPicks(client, PROJECT_ID, REF_A, [
      { usageId: U_A_SHARED, pickedQty: 4 },
      { usageId: U_A_SOLO, pickedQty: 6 },
    ]);
    check(
      'a batch fills every line it names, in one call',
      filledA.map((p) => [p.usageId, p.pickedQty, p.requiredQty]),
      [
        [U_A_SHARED, 4, 4],
        [U_A_SOLO, 6, 6],
      ],
    );
    check(
      'and answers with what each line could still be filled to, after the batch',
      filledA.map((p) => p.onHandQty),
      [4, 6],
    );
    await checkLedger(client, 'after filling A');

    // B needs 2 of the shared part; A has taken 4 of the 5 the project holds.
    // This is the case a per-line ceiling cannot see: B's own line is well
    // under its requirement, and there is still only one piece left.
    check(
      "B's pick list sees the pile A has already drawn down",
      await pickedOf(client, REF_B),
      [[U_B_SHARED, 0, 1]],
    );
    await checkRefuses(
      'taking more of a shared part than the project still holds is refused',
      () => applySubProductPicks(client, PROJECT_ID, REF_B, [{ usageId: U_B_SHARED, pickedQty: 2 }]),
      409,
      ErrorCodes.SUB_PRODUCT_PARTS_UNAVAILABLE,
    );
    await checkLedger(client, 'after a refused pick');

    const partialB = await applySubProductPicks(client, PROJECT_ID, REF_B, [
      { usageId: U_B_SHARED, pickedQty: 1 },
    ]);
    check(
      'the last piece can still be taken, leaving the line short',
      partialB.map((p) => [p.pickedQty, p.requiredQty, p.onHandQty]),
      [[1, 2, 1]],
    );
    await checkLedger(client, 'after part-filling B');

    // --- refusals ---------------------------------------------------------
    await checkRefuses(
      'picking more than a line needs is refused',
      () => applySubProductPicks(client, PROJECT_ID, REF_A, [{ usageId: U_A_SOLO, pickedQty: 7 }]),
      422,
      ErrorCodes.PICKED_QTY_ABOVE_REQUIRED,
    );
    await checkRefuses(
      "a line from another sub-product is not reachable through this one's list",
      () => applySubProductPicks(client, PROJECT_ID, REF_A, [{ usageId: U_B_SHARED, pickedQty: 1 }]),
      404,
      ErrorCodes.PROJECT_PART_USAGE_NOT_FOUND,
    );
    await checkRefuses(
      'a sub-product this project never froze is a 404',
      () =>
        applySubProductPicks(
          client,
          PROJECT_ID,
          { projectProductId: PPROD_ID, subProductRevisionId: 987654321 },
          [{ usageId: U_A_SHARED, pickedQty: 1 }],
        ),
      404,
      ErrorCodes.SUB_PRODUCT_NOT_IN_PROJECT,
    );
    await checkLedger(client, 'after the refusals');

    // --- marking ----------------------------------------------------------
    await checkRefuses(
      'a sub-product with a short line cannot be marked prepared',
      () => markSubProductPrepared(client, PROJECT_ID, REF_B, null),
      409,
      ErrorCodes.SUB_PRODUCT_PARTS_NOT_PICKED,
    );

    const labels = await markSubProductPrepared(client, PROJECT_ID, REF_A, null);
    check('marking names the sub-product and the product it sits under', labels, {
      subProduct: 'Frame (A)',
      product: 'Prep rig (Rev. 1)',
    });
    await checkLedger(client, 'after marking A — marking moves no quantity');

    await checkRefuses(
      'marking the same sub-product twice is refused',
      () => markSubProductPrepared(client, PROJECT_ID, REF_A, null),
      409,
      ErrorCodes.SUB_PRODUCT_ALREADY_PREPARED,
    );
    await checkRefuses(
      "a prepared sub-product's box is not open for editing",
      () => applySubProductPicks(client, PROJECT_ID, REF_A, [{ usageId: U_A_SHARED, pickedQty: 3 }]),
      409,
      ErrorCodes.SUB_PRODUCT_ALREADY_PREPARED,
    );

    // --- the board aggregate ---------------------------------------------
    const board = await loadBoardSubProducts(client, [PROJECT_ID]);
    check(
      'the board splits the project into one card per sub-product',
      board.get(PROJECT_ID)?.map((s) => [s.name, s.requiredQty, s.pickedQty, s.prepared, s.inPreparation]),
      [
        ['Frame', 10, 10, true, false],
        ['Lid', 2, 1, false, true],
      ],
    );
    check(
      'and reports how many of each card\'s lines the project can still finish off',
      board.get(PROJECT_ID)?.map((s) => [s.partCount, s.readyPartCount]),
      [
        [2, 2],
        [1, 0],
      ],
    );

    // --- un-marking -------------------------------------------------------
    await unmarkSubProductPrepared(client, PROJECT_ID, REF_A);
    check(
      'un-marking leaves the picks exactly as they were',
      await pickedOf(client, REF_A),
      [
        [U_A_SHARED, 4, 4],
        [U_A_SOLO, 6, 6],
      ],
    );
    await checkLedger(client, 'after un-marking A');
    await checkRefuses(
      'un-marking something that is not marked is refused',
      () => unmarkSubProductPrepared(client, PROJECT_ID, REF_A),
      409,
      ErrorCodes.SUB_PRODUCT_NOT_PREPARED,
    );

    // --- putting parts back ----------------------------------------------
    await applySubProductPicks(client, PROJECT_ID, REF_A, [{ usageId: U_A_SHARED, pickedQty: 0 }]);
    await checkLedger(client, 'after emptying a line');
    check(
      'putting a shared part back gives the other sub-product its pile again',
      await pickedOf(client, REF_B),
      [[U_B_SHARED, 1, 2]],
    );

    // --- round trips ------------------------------------------------------
    const counter = countingClient(client);
    await applySubProductPicks(counter.client, PROJECT_ID, REF_A, [
      { usageId: U_A_SHARED, pickedQty: 4 },
      { usageId: U_A_SOLO, pickedQty: 5 },
    ]);
    check(
      'a batch is one locked read plus one UPDATE per table, whatever it carries',
      counter.count(),
      3,
    );
    await checkLedger(client, 'after the counted batch');

    const noopCounter = countingClient(client);
    await applySubProductPicks(noopCounter.client, PROJECT_ID, REF_A, [
      { usageId: U_A_SHARED, pickedQty: 4 },
    ]);
    check('re-sending a stored quantity writes nothing', noopCounter.count(), 1);

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
