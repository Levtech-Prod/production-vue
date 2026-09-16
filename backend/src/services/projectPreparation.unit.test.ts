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
// Run: npm run test:unit
// ===========================================================================
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report } from '../testing/check.js';
import { resolvePickQty } from './projectPreparation.js';

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

  process.exit(report() === 0 ? 0 : 1);
}

void main();
