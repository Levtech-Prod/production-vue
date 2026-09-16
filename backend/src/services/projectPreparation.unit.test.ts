// ===========================================================================
// `resolvePickQty` — the two ceilings a pick-list write must enforce, both
// pure so they run with no database (CLAUDE.md's first test tier: new logic
// belongs here whenever it can):
//
//  - a line may never hold more than it needs, which is the API's rule alone:
//    the requirement spans project_part_usages and project_products, so no
//    CHECK can hold it.
//  - a line may never be raised past what the project holds and has not
//    already put in some other box, or
//    chk_project_parts_prepared_within_pickable would refuse the write as an
//    unattributable constraint violation.
//
// The case these exist for is the ordinary one: a line needs 5, the shelf
// holds 2, the other 3 are on order. Picking those 2 must be accepted, and
// picking a third must not.
//
// `resolveBulkPicks` then applies those ceilings across a whole batch, which
// is where the interesting arithmetic is: `unpickedQty` is a per-PART holding,
// so two lines of one batch can be looking at the same pile. Run as a loop
// over `resolvePickQty` each would read the stored holding and both would be
// allowed to take it — a batch of two that overdraws the project and reaches
// chk_project_parts_prepared_within_pickable as a raw 23514 naming nothing.
//
// Run: npm run test:unit
// ===========================================================================
import { ApiError } from '../apiError.js';
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report } from '../testing/check.js';
import { resolveBulkPicks, resolvePickQty, type BulkPickLine } from './projectPreparation.js';

async function main() {
  // The 2-of-5 line: nothing picked yet, and the project holds 2.
  const shortLine = { requiredQty: 5, pickedQty: 0, unpickedQty: 2 };

  check('picking what the shelf holds is accepted', resolvePickQty(shortLine, 2), 2);
  check('picking less than the shelf holds is accepted', resolvePickQty(shortLine, 1), 1);
  check('picking nothing is a no-op, not a refusal', resolvePickQty(shortLine, 0), 0);
  await checkRefuses(
    'raising past what the project holds is refused',
    () => resolvePickQty(shortLine, 3),
    409,
    ErrorCodes.SUB_PRODUCT_PARTS_UNAVAILABLE,
  );
  await checkRefuses(
    'picking more than the line needs is refused',
    () => resolvePickQty({ requiredQty: 5, pickedQty: 0, unpickedQty: 99 }, 6),
    422,
    ErrorCodes.PICKED_QTY_ABOVE_REQUIRED,
  );

  // Both ceilings broken at once: the per-line one is reported, because
  // "that is more than this needs" is the answer that makes sense to act on.
  await checkRefuses(
    'over the requirement AND over the holding names the requirement',
    () => resolvePickQty(shortLine, 9),
    422,
    ErrorCodes.PICKED_QTY_ABOVE_REQUIRED,
  );

  // The half-filled line, with the shelf now empty — the state the board has
  // to keep a card for, and the one a person comes back to.
  const halfPicked = { requiredQty: 5, pickedQty: 2, unpickedQty: 0 };

  check('putting parts back needs no headroom', resolvePickQty(halfPicked, 0), -2);
  check('putting some back needs no headroom either', resolvePickQty(halfPicked, 1), -1);
  check('re-sending the stored quantity moves nothing', resolvePickQty(halfPicked, 2), 0);
  await checkRefuses(
    'raising a half-picked line with nothing left to pick is refused',
    () => resolvePickQty(halfPicked, 3),
    409,
    ErrorCodes.SUB_PRODUCT_PARTS_UNAVAILABLE,
  );

  // A line the project can finish outright.
  const coveredLine = { requiredQty: 4, pickedQty: 1, unpickedQty: 10 };
  check('finishing a line is accepted', resolvePickQty(coveredLine, 4), 3);
  check('the delta is the difference, not the new value', resolvePickQty(coveredLine, 2), 1);

  // The boundary itself: exactly the holding, and exactly the requirement.
  check(
    'raising by exactly what is held is accepted — the ceiling is inclusive',
    resolvePickQty({ requiredQty: 10, pickedQty: 4, unpickedQty: 3 }, 7),
    3,
  );
  check(
    'picking exactly what the line needs is accepted',
    resolvePickQty({ requiredQty: 6, pickedQty: 0, unpickedQty: 6 }, 6),
    6,
  );

  // =========================================================================
  // resolveBulkPicks — the same ceilings, against one shared pile per part.
  // =========================================================================

  /** Two lines drawing on ONE project_parts row holding 5 pieces. */
  const sharedPile = (): BulkPickLine[] => [
    { usageId: 1, projectPartId: 100, requiredQty: 4, pickedQty: 0, unpickedQty: 5 },
    { usageId: 2, projectPartId: 100, requiredQty: 4, pickedQty: 0, unpickedQty: 5 },
  ];

  check(
    'a batch reports the net movement per part, not per line',
    [...resolveBulkPicks(sharedPile(), new Map([[1, 3], [2, 2]])).deltaByProjectPart],
    [[100, 5]],
  );
  await checkRefuses(
    'two lines cannot each take the last of a pile they share',
    () => resolveBulkPicks(sharedPile(), new Map([[1, 3], [2, 3]])),
    409,
    ErrorCodes.SUB_PRODUCT_PARTS_UNAVAILABLE,
  );

  // A loop over resolvePickQty would accept the batch above: each line sees
  // `unpickedQty: 5` as stored, and 3 is under it. The running headroom is the
  // whole difference, so it is worth pinning that the SECOND line is the one
  // refused — the first was legitimately affordable when it was resolved.
  try {
    resolveBulkPicks(sharedPile(), new Map([[1, 3], [2, 3]]));
    check('the over-drawing batch throws', 'no error thrown', 'threw');
  } catch (err) {
    check(
      'and names the line that could not be covered, so a list of thirty can point at one row',
      err instanceof ApiError ? err.payload : err,
      { usageId: 2 },
    );
  }

  check(
    'a line the batch does not name is left alone, however its neighbours move',
    resolveBulkPicks(sharedPile(), new Map([[1, 5 - 1]])).moved.map((m) => m.usageId),
    [1],
  );
  check(
    'and a line re-sent at the quantity it already holds is not a write',
    resolveBulkPicks(sharedPile(), new Map([[1, 0], [2, 4]])).moved.map((m) => m.usageId),
    [2],
  );

  // Putting parts back is resolved first, which is what lets one batch move a
  // piece from one line of a part to another. Resolved in the given order
  // instead, the taking line would be refused against a pile the putting-back
  // line was about to refill — and which of the two came first in the request
  // is not something a "tick everything" click has any reason to control.
  const pileSpentOnLineOne: BulkPickLine[] = [
    { usageId: 1, projectPartId: 100, requiredQty: 4, pickedQty: 4, unpickedQty: 0 },
    { usageId: 2, projectPartId: 100, requiredQty: 4, pickedQty: 0, unpickedQty: 0 },
  ];
  check(
    'one batch can move a piece between two lines of the same part, in either order',
    [...resolveBulkPicks(pileSpentOnLineOne, new Map([[2, 1], [1, 3]])).deltaByProjectPart],
    [[100, 0]],
  );

  // Two parts, so two independent piles — the ordinary case, and a check that
  // the headroom is keyed by part rather than shared across the batch.
  const twoParts: BulkPickLine[] = [
    { usageId: 1, projectPartId: 100, requiredQty: 4, pickedQty: 0, unpickedQty: 4 },
    { usageId: 2, projectPartId: 200, requiredQty: 6, pickedQty: 0, unpickedQty: 6 },
  ];
  check(
    'separate parts do not compete for each other\'s headroom',
    [...resolveBulkPicks(twoParts, new Map([[1, 4], [2, 6]])).deltaByProjectPart],
    [
      [100, 4],
      [200, 6],
    ],
  );
  check('an empty batch moves nothing', resolveBulkPicks(twoParts, new Map()).moved, []);

  process.exit(report() === 0 ? 0 : 1);
}

void main();
