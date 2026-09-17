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
// Plus `resolveDraftPartQuantity` (§12.2), which decides whether a draft's
// typed purchase quantity is stored at all — the difference between a table
// holding decisions and one holding a copy of a derivable number. Its whole
// decision table is here because the first version of it gated on "the
// displayed value changed", which is a different question and is wrong in one
// specific state; see the coincidence block at the end.
//
// Run: npm run test:unit
// ===========================================================================
import { ErrorCodes } from '../errorCodes.js';
import { ApiError } from '../apiError.js';
import { check, checkRefuses, report, failureCount } from '../testing/check.js';
import { resolveDraftPartQuantity, resolveProjectPartUpdate } from './projectBom.js';

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

  // The check above only proves which code comes back; it says nothing about
  // whether the second, unreported problem is still discoverable without a
  // retry. `fromStockQty: 2, missingQty: 11` breaks both floors at once
  // (missingQty 11 < orderedQty 12; fromStockQty 2 + receivedQty 2 = 4 <
  // preparedQty 5), so the payload must name the one that didn't get thrown.
  try {
    resolveProjectPartUpdate(current, { fromStockQty: 2, missingQty: 11 });
    check('both floors violated throws', 'no error thrown', 'threw');
  } catch (err) {
    check(
      "both floors violated: the payload also names from_stock_qty's problem, so the caller does not have to fix-and-retry to discover it",
      err instanceof ApiError ? err.payload : err,
      { alsoViolates: ErrorCodes.FROM_STOCK_QTY_BELOW_PREPARED },
    );
  }

  try {
    // fromStockQty untouched at 6, well above its floor of 3.
    resolveProjectPartUpdate(current, { missingQty: 11 });
    check('a single violation throws', 'no error thrown', 'threw');
  } catch (err) {
    check(
      'a single violation carries no alsoViolates payload',
      err instanceof ApiError ? err.payload : err,
      undefined,
    );
  }

  // --- resolveDraftPartQuantity (§12.2) -----------------------------------
  //
  // The seed is `required - MIN(required, free stock)`, floored at zero, so
  // "the default" moves with stock and with what the project needs. A row is
  // stored only while the typed value differs from it.

  /** The row as the draft table reads it, with no stored override. */
  const seeded = (requiredQty: number, free: number, missingQty: number) => ({
    requiredQty,
    free,
    missingQty,
    overridden: false,
  });
  /** The same row with a stored override; `missingQty` is what it holds. */
  const stored = (requiredQty: number, free: number, missingQty: number) => ({
    requiredQty,
    free,
    missingQty,
    overridden: true,
  });

  // Nothing stored yet.
  check(
    'retyping the seeded shortfall on an un-overridden row writes nothing',
    resolveDraftPartQuantity(seeded(100, 40, 60), 60),
    { action: 'none', missingQty: 60, overridden: false, audit: false },
  );
  check(
    'a reel-sized purchase is stored',
    resolveDraftPartQuantity(seeded(100, 40, 60), 260),
    { action: 'upsert', missingQty: 260, overridden: true, audit: true },
  );
  check(
    'buying less than the shortfall is stored too',
    resolveDraftPartQuantity(seeded(100, 40, 60), 10),
    { action: 'upsert', missingQty: 10, overridden: true, audit: true },
  );
  check(
    'topping up the shelf on a part that is fully in stock — the case §12 exists for',
    resolveDraftPartQuantity(seeded(10, 40, 0), 500),
    { action: 'upsert', missingQty: 500, overridden: true, audit: true },
  );
  check(
    'buying nothing when the shelf is short is a decision, not the default',
    resolveDraftPartQuantity(seeded(7, 0, 7), 0),
    { action: 'upsert', missingQty: 0, overridden: true, audit: true },
  );
  check(
    'a part with nothing on the shelf defaults to buying all of it',
    resolveDraftPartQuantity(seeded(7, 0, 7), 7),
    { action: 'none', missingQty: 7, overridden: false, audit: false },
  );
  check(
    'negative free stock (a stale claim, §11.8) is treated as none, not as extra demand',
    resolveDraftPartQuantity(seeded(7, -8, 7), 7),
    { action: 'none', missingQty: 7, overridden: false, audit: false },
  );

  // Something stored.
  check(
    'changing a stored quantity rewrites it',
    resolveDraftPartQuantity(stored(100, 40, 260), 300),
    { action: 'upsert', missingQty: 300, overridden: true, audit: true },
  );
  check(
    're-sending a stored quantity writes nothing — the row already holds it',
    resolveDraftPartQuantity(stored(100, 40, 260), 260),
    { action: 'none', missingQty: 260, overridden: true, audit: false },
  );
  check(
    'typing the seeded quantity back clears the override',
    resolveDraftPartQuantity(stored(100, 40, 260), 60),
    { action: 'delete', missingQty: 60, overridden: false, audit: true },
  );

  // --- the coincidence: a stored override that now EQUALS the seed ---------
  //
  // Required 40, nothing on the shelf, so the seed was 40 and the buyer typed
  // 10. Thirty pieces then arrive from somewhere else, free stock is 30, and
  // the seed becomes 40 - 30 = 10 — the number already stored and already on
  // screen. Typing 10 must still delete the row: the displayed value has not
  // moved, but the row has to go or there is no way left to clear it, and it
  // would freeze at Start as `missing_qty_overridden` and sit out every
  // recalculate for the life of the project.
  check(
    'clearing an override that has come to equal the seed still deletes the row',
    resolveDraftPartQuantity(stored(40, 30, 10), 10),
    { action: 'delete', missingQty: 10, overridden: false, audit: false },
  );
  check(
    'and the same row is left alone when the typed value is still a decision',
    resolveDraftPartQuantity(stored(40, 30, 10), 11),
    { action: 'upsert', missingQty: 11, overridden: true, audit: true },
  );

  report();
  process.exit(failureCount() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
