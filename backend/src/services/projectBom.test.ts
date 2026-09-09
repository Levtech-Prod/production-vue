// ===========================================================================
// Acceptance check for services/projectBom.ts, kept in the repo rather than
// run once by hand (§11.8 C1 for why).
//
// The fixture is §3.4's worked example verbatim, because that is the hand
// calculation the aggregation has to match: CTRL-100 R3 x2 and PSU-200 R1 x3
// share a screw across three sub-products, so Screw M3 = (2 + 2) x 2 + 6 x 3
// = 26. Checked over both forms of the BOM, including that they answer with
// the same shape and in JS numbers rather than NUMERIC strings — and that
// the freeze turns the first form into the second without changing a number.
//
// Runs against the dev database inside one transaction that is ALWAYS rolled
// back. Like projectStock.test.ts, NOT safe to point at production: the
// rollback undoes the writes, the locks it takes are real.
//
// Run: npm run test:projectBom
// ===========================================================================
import { pool } from '../db.js';
import { check, checkRefuses, report, failureCount } from '../testing/check.js';
import { ErrorCodes } from '../errorCodes.js';
import type { Queryable } from '../db.js';
import {
  computeProjectBom,
  freezeProjectBom,
  loadFrozenProjectBom,
  loadProjectPartsPayload,
  toProjectPartRows,
  type ProjectPartRow,
} from './projectBom.js';

// Ids far out of the way, mirroring projectStock.test.ts.
const CATEGORY_ID = 9991001;
const COMPANY_ID = 9991001;
const TYPE_NAME = 'test-projectBom type';

const PART_SCREW = 9991001;
const PART_RELAY = 9991002;
const PART_CAP = 9991003;

const PRODUCT_CTRL = 9991001;
const PRODUCT_PSU = 9991002;
const REV_CTRL_R3 = 9991001;
const REV_PSU_R1 = 9991002;
const REV_CTRL_R4 = 9991003; // the same product, a second revision (§3.4)

const SUB_FRONT = 9991001;
const SUB_BASE = 9991002;
const SUB_PSU_BOARD = 9991003;
const SPR_FRONT_B = 9991001;
const SPR_BASE_A = 9991002;
const SPR_PSU_C = 9991003;

const PROJECT_DRAFT = 9991001;
const PROJECT_STARTED = 9991002;
const PROJECT_OTHER = 9991003; // started, claims 4 screws — the competing reservation
const PROJECT_EMPTY = 9991004; // draft with no products
const PROJECT_TWO_REVISIONS = 9991005; // draft holding CTRL-100 at R3 and at R4

const PP_DRAFT_CTRL = 9991001;
const PP_DRAFT_PSU = 9991002;
const PP_STARTED_CTRL = 9991003;
const PP_STARTED_PSU = 9991004;
const PP_TWO_R3 = 9991005;
const PP_TWO_R4 = 9991006;

const FROZEN_SCREW = 9991001;
const FROZEN_RELAY = 9991002;
const FROZEN_CAP = 9991003;

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

function rowFor(rows: ProjectPartRow[], partId: number): ProjectPartRow {
  const row = rows.find((r) => r.part.id === partId);
  if (!row) throw new Error(`no row for part ${partId}`);
  return row;
}

async function seed(client: Queryable) {
  await client.query(`INSERT INTO part_categories (id, name) VALUES ($1, 'test-projectBom')`, [
    CATEGORY_ID,
  ]);
  await client.query(
    `INSERT INTO parts (id, category_id, name, code) VALUES
       ($1, $4, 'Capacitor 100uF', 'TEST-PB-CAP'),
       ($2, $4, 'Relay 5V',        'TEST-PB-RLY'),
       ($3, $4, 'Screw M3',        'TEST-PB-SCR')`,
    [PART_CAP, PART_RELAY, PART_SCREW, CATEGORY_ID],
  );
  await client.query(`INSERT INTO companies (id, name) VALUES ($1, 'test-projectBom co')`, [
    COMPANY_ID,
  ]);
  // Screw: 12 received, 2 already consumed -> available 10. Capacitor: 100.
  // Relay: nothing at all.
  await client.query(
    `INSERT INTO stock_entries (part_id, company_id, type, quantity, quantity_consumed, price_per_piece) VALUES
       ($1, $3, 'received', 12, 2, 1),
       ($2, $3, 'received', 100, 0, 1)`,
    [PART_SCREW, PART_CAP, COMPANY_ID],
  );

  // `products.type` / `sub_products.type` are FKs to the type tables by name.
  await client.query(`INSERT INTO product_types (name) VALUES ($1)`, [TYPE_NAME]);
  await client.query(`INSERT INTO sub_product_types (name) VALUES ($1)`, [TYPE_NAME]);
  await client.query(
    `INSERT INTO products (id, name, sku, type) VALUES
       ($1, 'Controller', 'CTRL-100', $3),
       ($2, 'Power supply', 'PSU-200', $3)`,
    [PRODUCT_CTRL, PRODUCT_PSU, TYPE_NAME],
  );
  await client.query(
    `INSERT INTO product_revisions (id, product_id, revision_number, label) VALUES
       ($1, $4, 3, 'R3'),
       ($2, $5, 1, 'R1'),
       ($3, $4, 4, 'R4')`,
    [REV_CTRL_R3, REV_PSU_R1, REV_CTRL_R4, PRODUCT_CTRL, PRODUCT_PSU],
  );
  await client.query(
    `INSERT INTO sub_products (id, product_id, name, sku, type) VALUES
       ($1, $4, 'Front panel', 'TEST-PB-FP', $6),
       ($2, $4, 'Base',        'TEST-PB-BS', $6),
       ($3, $5, 'PSU board',   'TEST-PB-PB', $6)`,
    [SUB_FRONT, SUB_BASE, SUB_PSU_BOARD, PRODUCT_CTRL, PRODUCT_PSU, TYPE_NAME],
  );
  await client.query(
    `INSERT INTO sub_product_revisions (id, sub_product_id, revision_number, label) VALUES
       ($1, $4, 2, 'rev B'),
       ($2, $5, 1, 'rev A'),
       ($3, $6, 3, 'rev C')`,
    [SPR_FRONT_B, SPR_BASE_A, SPR_PSU_C, SUB_FRONT, SUB_BASE, SUB_PSU_BOARD],
  );
  await client.query(
    `INSERT INTO product_revision_sub_products (product_revision_id, sub_product_revision_id, position) VALUES
       ($1, $4, 0),
       ($1, $5, 1),
       ($2, $6, 0),
       ($3, $5, 0)`,
    [REV_CTRL_R3, REV_PSU_R1, REV_CTRL_R4, SPR_FRONT_B, SPR_BASE_A, SPR_PSU_C],
  );
  // The worked example's compositions, for ONE unit of each product.
  await client.query(
    `INSERT INTO sub_product_revision_parts (sub_product_revision_id, part_id, quantity) VALUES
       ($1, $4, 2),
       ($2, $4, 2),
       ($2, $5, 1),
       ($3, $4, 6),
       ($3, $6, 2)`,
    [SPR_FRONT_B, SPR_BASE_A, SPR_PSU_C, PART_SCREW, PART_RELAY, PART_CAP],
  );

  await client.query(
    `INSERT INTO projects (id, name, status) VALUES
       ($1, 'test draft', 'draft'),
       ($2, 'test started', 'started'),
       ($3, 'test other', 'started'),
       ($4, 'test empty draft', 'draft'),
       ($5, 'test two revisions', 'draft')`,
    [PROJECT_DRAFT, PROJECT_STARTED, PROJECT_OTHER, PROJECT_EMPTY, PROJECT_TWO_REVISIONS],
  );
  await client.query(
    `INSERT INTO project_products (id, project_id, product_id, product_revision_id, quantity, position) VALUES
       ($1, $5, $7, $9,  2, 0),
       ($2, $5, $8, $10, 3, 1),
       ($3, $6, $7, $9,  2, 0),
       ($4, $6, $8, $10, 3, 1),
       ($14, $12, $7, $9,  1, 0),
       ($11, $12, $7, $13, 1, 1)`,
    [
      PP_DRAFT_CTRL,
      PP_DRAFT_PSU,
      PP_STARTED_CTRL,
      PP_STARTED_PSU,
      PROJECT_DRAFT,
      PROJECT_STARTED,
      PRODUCT_CTRL,
      PRODUCT_PSU,
      REV_CTRL_R3,
      REV_PSU_R1,
      PP_TWO_R4,
      PROJECT_TWO_REVISIONS,
      REV_CTRL_R4,
      PP_TWO_R3,
    ],
  );
  // A competing started project holding 4 screws, so free stock is 6 of 10.
  await client.query(
    `INSERT INTO project_parts (project_id, part_id, required_qty, from_stock_qty, missing_qty)
     VALUES ($1, $2, 10, 4, 6)`,
    [PROJECT_OTHER, PART_SCREW],
  );
}

/** The same BOM frozen, but written by hand rather than by `freezeProjectBom`:
 *  the reader has to be checked against non-zero progress buckets, and a real
 *  freeze always leaves those at zero. (The freeze's own output is checked at
 *  the end.) Seeded only after the draft checks have run, so this project's
 *  claim on the screws does not move the free stock those checks assert. */
async function seedFrozen(client: Queryable) {
  await client.query(
    `INSERT INTO project_parts
       (id, project_id, part_id, required_qty, from_stock_qty, missing_qty,
        ordered_qty, received_qty, prepared_qty)
     VALUES
       ($1, $4, $5, 26, 6, 20, 20, 8, 3),
       ($2, $4, $6, 2,  0, 2,  0,  0, 0),
       ($3, $4, $7, 6,  6, 0,  0,  0, 0)`,
    [FROZEN_SCREW, FROZEN_RELAY, FROZEN_CAP, PROJECT_STARTED, PART_SCREW, PART_RELAY, PART_CAP],
  );
  await client.query(
    `INSERT INTO project_part_usages
       (project_part_id, project_product_id, sub_product_revision_id, qty_per_unit)
     VALUES
       ($1, $4, $6, 2),
       ($1, $4, $7, 2),
       ($1, $5, $8, 6),
       ($2, $4, $7, 1),
       ($3, $5, $8, 2)`,
    [
      FROZEN_SCREW,
      FROZEN_RELAY,
      FROZEN_CAP,
      PP_STARTED_CTRL,
      PP_STARTED_PSU,
      SPR_FRONT_B,
      SPR_BASE_A,
      SPR_PSU_C,
    ],
  );
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed(client);

    // --- draft: computed live from the pinned revisions ---------------------
    const draftRows = toProjectPartRows(await computeProjectBom(client, PROJECT_DRAFT), 'draft');

    check(
      'draft: one row per distinct part, ordered by name',
      draftRows.map((r) => r.part.code),
      ['TEST-PB-CAP', 'TEST-PB-RLY', 'TEST-PB-SCR'],
    );
    check('draft: rows are not yet frozen', draftRows.map((r) => r.id), [null, null, null]);

    const screw = rowFor(draftRows, PART_SCREW);
    check('draft: shared part required_qty matches the hand calculation', screw.requiredQty, 26);
    check(
      'draft: three usages across two products collapse to two product entries',
      screw.products.map((p) => [p.sku, p.qtyPerUnit, p.qtyForProduct]),
      [
        ['CTRL-100', 4, 8],
        ['PSU-200', 6, 18],
      ],
    );
    check(
      'draft: qtyForProduct sums to requiredQty',
      screw.products.reduce((sum, p) => sum + p.qtyForProduct, 0),
      screw.requiredQty,
    );
    check('draft: revision label travels with the chip', screw.products[0].revisionLabel, 'R3');
    check('draft: category name ships with the row', screw.part.categoryName, 'test-projectBom');
    check('draft: available is the FIFO remainder', screw.availableQty, 10);
    check('draft: reserved is the other started project', screw.reservedQty, 4);
    check('draft: from stock is capped at free stock', screw.fromStockQty, 6);
    check('draft: the rest has to be bought', screw.missingQty, 20);
    check(
      'draft: progress buckets are zero',
      [screw.orderedQty, screw.receivedQty, screw.preparedQty, screw.missingQtyOverridden],
      [0, 0, 0, false],
    );
    check(
      'draft: derived quantities',
      [screw.toBuyQty, screw.onOrderQty, screw.toPickQty],
      [20, 0, 6],
    );
    check('draft: claims within available stock are no shortfall', screw.stockShortfall, false);

    const relay = rowFor(draftRows, PART_RELAY);
    check('draft: single-product part required_qty', relay.requiredQty, 2);
    check(
      'draft: single-product part lists one product',
      relay.products.map((p) => [p.sku, p.qtyPerUnit, p.qtyForProduct]),
      [['CTRL-100', 1, 2]],
    );
    check('draft: a part with no stock is all missing', [relay.fromStockQty, relay.missingQty], [0, 2]);

    const cap = rowFor(draftRows, PART_CAP);
    check('draft: second product-only part required_qty', cap.requiredQty, 6);
    check(
      'draft: it belongs to the second product alone',
      cap.products.map((p) => [p.sku, p.qtyForProduct]),
      [['PSU-200', 6]],
    );
    check('draft: ample stock covers it entirely', [cap.fromStockQty, cap.missingQty], [6, 0]);

    // A NUMERIC column would arrive as a string and reach the table as
    // "26.000"; migration 025 made every quantity INTEGER, so they are numbers.
    check(
      'draft: quantities are JS numbers, not NUMERIC strings',
      [screw.requiredQty, screw.fromStockQty, screw.products[0].qtyForProduct].map(
        (v) => typeof v,
      ),
      ['number', 'number', 'number'],
    );

    const emptyRows = toProjectPartRows(await computeProjectBom(client, PROJECT_EMPTY), 'draft');
    check('draft with no products: no rows, no error', emptyRows, []);

    // §3.4's edge case: the same product pinned at two revisions. The chips
    // are per project_products line, not per product, or the two would
    // collapse into one and their quantities would be lost.
    const twoRevisionRows = toProjectPartRows(
      await computeProjectBom(client, PROJECT_TWO_REVISIONS),
      'draft',
    );
    const twoRevisionScrew = rowFor(twoRevisionRows, PART_SCREW);
    check(
      'same product at two revisions stays two product entries',
      twoRevisionScrew.products.map((p) => [p.sku, p.revisionLabel, p.qtyForProduct]),
      [
        ['CTRL-100', 'R3', 4],
        ['CTRL-100', 'R4', 2],
      ],
    );
    check('same product at two revisions: required_qty is their sum', twoRevisionScrew.requiredQty, 6);

    // --- started: read back from the frozen tables --------------------------
    await seedFrozen(client);
    const frozenRows = toProjectPartRows(await loadFrozenProjectBom(client, PROJECT_STARTED), 'started');

    check(
      'frozen: same parts, same order',
      frozenRows.map((r) => r.part.code),
      ['TEST-PB-CAP', 'TEST-PB-RLY', 'TEST-PB-SCR'],
    );
    check(
      'frozen: rows carry their project_parts id',
      frozenRows.map((r) => r.id),
      [FROZEN_CAP, FROZEN_RELAY, FROZEN_SCREW],
    );

    const frozenScrew = rowFor(frozenRows, PART_SCREW);
    check('frozen: required_qty is the stored one', frozenScrew.requiredQty, 26);
    // Everything but `projectProductId`, which is per project by definition.
    const productShape = (row: ProjectPartRow) =>
      row.products.map(({ productId, sku, revisionLabel, qtyPerUnit, qtyForProduct }) => ({
        productId,
        sku,
        revisionLabel,
        qtyPerUnit,
        qtyForProduct,
      }));
    check(
      'frozen: stored usages collapse exactly as the computed ones did',
      productShape(frozenScrew),
      productShape(screw),
    );
    check(
      'frozen: each product entry points at its own project line',
      frozenScrew.products.map((p) => p.projectProductId),
      [PP_STARTED_CTRL, PP_STARTED_PSU],
    );
    check(
      'frozen: derived quantities read the progress buckets',
      [frozenScrew.toBuyQty, frozenScrew.onOrderQty, frozenScrew.toPickQty],
      [0, 12, 11],
    );
    check(
      'frozen: a claim larger than what is left on the shelf is flagged',
      [frozenScrew.availableQty, frozenScrew.reservedQty, frozenScrew.stockShortfall],
      [10, 4, true],
    );
    check(
      'frozen: an uncontested row is not flagged',
      rowFor(frozenRows, PART_CAP).stockShortfall,
      false,
    );

    // The frontend must not branch on which form it got (§5.4).
    check(
      'both forms answer with the same payload shape',
      Object.keys(frozenScrew).sort(),
      Object.keys(screw).sort(),
    );
    check(
      'both forms answer with the same product entry shape',
      Object.keys(frozenScrew.products[0]).sort(),
      Object.keys(screw.products[0]).sort(),
    );

    check(
      'frozen: stored quantities come back as numbers too',
      [frozenScrew.requiredQty, frozenScrew.orderedQty].map((v) => typeof v),
      ['number', 'number'],
    );

    // --- stopping: a status flip, and nothing else ------------------------
    const beforeStop = rowFor(
      toProjectPartRows(await computeProjectBom(client, PROJECT_DRAFT), 'draft'),
      PART_SCREW,
    );
    check(
      'a started claim is counted against every other project',
      [beforeStop.availableQty, beforeStop.reservedQty],
      [10, 15], // 4 from the other project + 6 + 8 - 3 outstanding from this one
    );

    await client.query(`UPDATE projects SET status = 'stopped' WHERE id = $1`, [PROJECT_STARTED]);

    const afterStop = rowFor(
      toProjectPartRows(await computeProjectBom(client, PROJECT_DRAFT), 'draft'),
      PART_SCREW,
    );
    check(
      'stopping releases the claim and writes no stock',
      [afterStop.availableQty, afterStop.reservedQty],
      [10, 4],
    );

    const stoppedScrew = rowFor(
      toProjectPartRows(await loadFrozenProjectBom(client, PROJECT_STARTED), 'stopped'),
      PART_SCREW,
    );
    check(
      'a stopped project keeps the quantities it froze',
      [stoppedScrew.requiredQty, stoppedScrew.fromStockQty, stoppedScrew.toPickQty],
      [26, 6, 11],
    );
    check('a stopped project no longer flags a shortfall', stoppedScrew.stockShortfall, false);

    // --- the payload switch, the decision the route used to own -----------
    const draftPayload = await loadProjectPartsPayload(client, PROJECT_DRAFT, 'draft');
    check(
      'draft status picks the computed rows',
      [draftPayload.draft, draftPayload.rows.length, draftPayload.rows[0].id],
      [true, 3, null],
    );
    const startedPayload = await loadProjectPartsPayload(client, PROJECT_STARTED, 'stopped');
    check(
      'a non-draft status picks the frozen rows',
      [
        startedPayload.draft,
        startedPayload.rows.length,
        startedPayload.rows.every((r) => r.id !== null),
      ],
      [false, 3, true],
    );

    // Neither reader may go per-part: one flatten plus one stock read for a
    // draft, one part read plus one usage read plus one stock read frozen.
    const computeCounter = countingQueryable(client);
    await computeProjectBom(computeCounter.db, PROJECT_DRAFT);
    check('computeProjectBom issues two round trips', computeCounter.count(), 2);

    const frozenCounter = countingQueryable(client);
    await loadFrozenProjectBom(frozenCounter.db, PROJECT_STARTED);
    check('loadFrozenProjectBom issues three round trips', frozenCounter.count(), 3);

    // --- the freeze: Start persists exactly what the draft was showing ----
    await checkRefuses(
      'freezing a project with no products is refused, not silently empty',
      () => freezeProjectBom(client, PROJECT_EMPTY),
      409,
      ErrorCodes.PROJECT_HAS_NO_PARTS,
    );
    check(
      'freezing writes one row per distinct part',
      await freezeProjectBom(client, PROJECT_DRAFT),
      3,
    );

    // The one property the whole freeze exists for: the numbers the salesman
    // was looking at are the numbers that got stored. `id` is the only field
    // that may differ, since a computed row has none.
    const withoutId = (rows: ProjectPartRow[]) => rows.map(({ id, ...rest }) => rest);
    const frozenDraft = toProjectPartRows(
      await loadFrozenProjectBom(client, PROJECT_DRAFT),
      'draft',
    );
    check(
      'the frozen rows are the computed ones, unchanged',
      withoutId(frozenDraft),
      withoutId(draftRows),
    );
    check(
      'and they now carry a project_parts id',
      frozenDraft.every((row) => row.id !== null),
      true,
    );

    const stored = await client.query<{
      code: string;
      requiredQty: number;
      fromStockQty: number;
      missingQty: number;
      overridden: boolean;
      orderedQty: number;
      receivedQty: number;
      preparedQty: number;
    }>(
      `SELECT p.code, pp.required_qty AS "requiredQty", pp.from_stock_qty AS "fromStockQty",
         pp.missing_qty AS "missingQty", pp.missing_qty_overridden AS "overridden",
         pp.ordered_qty AS "orderedQty", pp.received_qty AS "receivedQty",
         pp.prepared_qty AS "preparedQty"
       FROM project_parts pp
       JOIN parts p ON p.id = pp.part_id
       WHERE pp.project_id = $1
       ORDER BY p.code`,
      [PROJECT_DRAFT],
    );
    check(
      'the sourcing columns are seeded from free stock',
      stored.rows.map((r) => [r.code, r.requiredQty, r.fromStockQty, r.missingQty]),
      [
        ['TEST-PB-CAP', 6, 6, 0],
        ['TEST-PB-RLY', 2, 0, 2],
        ['TEST-PB-SCR', 26, 6, 20],
      ],
    );
    check(
      'and the progress buckets start empty',
      stored.rows.map((r) => [r.orderedQty, r.receivedQty, r.preparedQty, r.overridden]),
      [
        [0, 0, 0, false],
        [0, 0, 0, false],
        [0, 0, 0, false],
      ],
    );

    const usageCounts = await client.query<{ code: string; usages: number }>(
      `SELECT p.code, COUNT(*)::int AS usages
       FROM project_part_usages ppu
       JOIN project_parts pp ON pp.id = ppu.project_part_id
       JOIN parts p ON p.id = pp.part_id
       WHERE pp.project_id = $1
       GROUP BY p.code
       ORDER BY p.code`,
      [PROJECT_DRAFT],
    );
    check(
      'one usage row per place the part is used, not per product',
      usageCounts.rows.map((r) => [r.code, r.usages]),
      [
        ['TEST-PB-CAP', 1],
        ['TEST-PB-RLY', 1],
        ['TEST-PB-SCR', 3],
      ],
    );

    // The claim only competes once the status flips — which Start does in the
    // same transaction as the freeze, and which is why the two belong together.
    await client.query(`UPDATE projects SET status = 'started' WHERE id = $1`, [PROJECT_DRAFT]);
    const observer = rowFor(
      toProjectPartRows(await computeProjectBom(client, PROJECT_TWO_REVISIONS), 'draft'),
      PART_SCREW,
    );
    check(
      'a started freeze reserves its claim against every other project',
      [observer.availableQty, observer.reservedQty, observer.fromStockQty, observer.missingQty],
      [10, 10, 0, 6],
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
