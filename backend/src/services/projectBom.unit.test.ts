// ===========================================================================
// `resolveProjectPartUpdate` — the two floors a PATCH must enforce, both pure
// so they run with no database (CLAUDE.md's first test tier: new logic
// belongs here whenever it can):
//
//  - missing_qty may never drop below ordered_qty, so a line can never be
//    made to owe less than it has already bought.
//  - from_stock_qty may never drop below what has already been prepared from
//    it, net of what's been received, or chk_project_parts_prepared_within_pickable
//    would refuse the write as an unattributable constraint violation.
//
// Run: npm run test:unit
// ===========================================================================
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report, failureCount } from '../testing/check.js';
import { resolveProjectPartUpdate } from './projectBom.js';

async function main() {
  // orderedQty=12 -> missing_qty floor. receivedQty=2, preparedQty=5 ->
  // from_stock_qty floor of 3 (5 - 2).
  const current = {
    fromStockQty: 6,
    missingQty: 20,
    orderedQty: 12,
    receivedQty: 2,
    preparedQty: 5,
  };

  // --- missing_qty vs. ordered_qty ----------------------------------------
  check(
    'raising missing above ordered is accepted',
    resolveProjectPartUpdate(current, { missingQty: 25 }),
    { fromStockQty: 6, missingQty: 25 },
  );
  check(
    'lowering missing but staying at ordered is accepted — the floor is inclusive',
    resolveProjectPartUpdate(current, { missingQty: 12 }),
    { fromStockQty: 6, missingQty: 12 },
  );
  await checkRefuses(
    'lowering missing below ordered is refused',
    () => resolveProjectPartUpdate(current, { missingQty: 11 }),
    409,
    ErrorCodes.MISSING_QTY_BELOW_ORDERED,
  );
  check(
    'from_stock_qty alone leaves missing_qty at its current value, still checked against ordered',
    resolveProjectPartUpdate(current, { fromStockQty: 9 }),
    { fromStockQty: 9, missingQty: 20 },
  );
  check(
    'both fields together',
    resolveProjectPartUpdate(current, { fromStockQty: 3, missingQty: 15 }),
    { fromStockQty: 3, missingQty: 15 },
  );
  await checkRefuses(
    'both fields together, still below ordered, is refused',
    () => resolveProjectPartUpdate(current, { fromStockQty: 3, missingQty: 10 }),
    409,
    ErrorCodes.MISSING_QTY_BELOW_ORDERED,
  );
  check(
    'neither field given leaves both current values, which already satisfy both floors',
    resolveProjectPartUpdate(current, {}),
    { fromStockQty: 6, missingQty: 20 },
  );

  // --- from_stock_qty vs. what's already been prepared --------------------
  check(
    'lowering from_stock_qty but staying at the prepared floor is accepted — inclusive here too',
    resolveProjectPartUpdate(current, { fromStockQty: 3 }),
    { fromStockQty: 3, missingQty: 20 },
  );
  await checkRefuses(
    'lowering from_stock_qty below what has been prepared (net of received) is refused',
    () => resolveProjectPartUpdate(current, { fromStockQty: 2 }),
    409,
    ErrorCodes.FROM_STOCK_QTY_BELOW_PREPARED,
  );
  check(
    'raising from_stock_qty is always fine regardless of the prepared floor',
    resolveProjectPartUpdate(current, { fromStockQty: 100 }),
    { fromStockQty: 100, missingQty: 20 },
  );
  check(
    'nothing has been prepared yet: from_stock_qty can drop all the way to zero',
    resolveProjectPartUpdate({ ...current, receivedQty: 0, preparedQty: 0 }, { fromStockQty: 0 }),
    { fromStockQty: 0, missingQty: 20 },
  );
  check(
    'received stock alone can cover what was prepared, freeing from_stock_qty to drop to zero',
    resolveProjectPartUpdate({ ...current, receivedQty: 5, preparedQty: 5 }, { fromStockQty: 0 }),
    { fromStockQty: 0, missingQty: 20 },
  );
  await checkRefuses(
    'missing_qty is checked first: both floors violated reports the ordered one',
    () => resolveProjectPartUpdate(current, { fromStockQty: 2, missingQty: 11 }),
    409,
    ErrorCodes.MISSING_QTY_BELOW_ORDERED,
  );

  report();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
