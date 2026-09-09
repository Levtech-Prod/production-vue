// ===========================================================================
// `resolveProjectPartUpdate` — the §3.3 floor a PATCH must enforce: missing_qty
// may never drop below ordered_qty, so a line can never be made to owe less
// than it has already bought. Pure, so this runs with no database
// (CLAUDE.md's first test tier: new logic belongs here whenever it can).
//
// Run: npm run test:unit
// ===========================================================================
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report, failureCount } from '../testing/check.js';
import { resolveProjectPartUpdate } from './projectBom.js';

async function main() {
  const current = { fromStockQty: 6, missingQty: 20, orderedQty: 12 };

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
    'neither field given leaves both current values, which already satisfy the floor',
    resolveProjectPartUpdate(current, {}),
    { fromStockQty: 6, missingQty: 20 },
  );

  report();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
