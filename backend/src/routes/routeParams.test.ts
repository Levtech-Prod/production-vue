// ===========================================================================
// `requireId` / `parseId` — adopted at 55 call sites by the refactor, several
// of which previously used `Number(req.params.x)` and so accepted values that
// could never match a row. These assertions pin what is now accepted, since
// the change is deliberate and its edges are what a caller notices.
//
// Pure functions, no database. Run: npm run test:unit
// ===========================================================================
import { parseId, requireId } from './routeParams.js';
import { ErrorCodes } from '../errorCodes.js';
import { check, checkRefuses, report } from '../testing/check.js';

async function main() {
  check(
    'ordinary ids pass through',
    ['1', '42', '2147483647'].map(parseId),
    [1, 42, 2147483647],
  );

  // The whole reason parseId exists: every one of these is truthy and not
  // NaN, so the old `Number(...)` guard let it through — either as an id that
  // can never match a row, or as a second spelling of one that can.
  check(
    'what Number() used to let through is now rejected',
    ['1.5', '1e3', '-5', '0', ' 5 ', '+5', '3abc', '0x10'].map(parseId),
    [null, null, null, null, null, null, null, null],
  );

  // Past `integer`'s ceiling Postgres raises 22003 at the cast, which is a
  // 500; the parser answers 400 instead.
  check(
    'and so is anything wider than an integer column',
    [parseId('2147483647'), parseId('2147483648'), parseId('99999999999')],
    [2147483647, null, null],
  );

  check(
    'and so is anything that is not a string',
    [parseId(undefined), parseId(null), parseId(['5']), parseId({}), parseId(5)],
    [null, null, null, null, null],
  );

  // Query params arrive as `string | string[] | ParsedQs`, which is why the
  // signature takes `unknown` rather than making every call site cast.
  check('an array-valued query param is not an id', parseId(['5', '6']), null);

  await checkRefuses(
    'requireId refuses with the code it was given',
    () => requireId('abc', ErrorCodes.INVALID_PROJECT_ID),
    400,
    ErrorCodes.INVALID_PROJECT_ID,
  );
  await checkRefuses(
    'and with a missing param',
    () => requireId(undefined, ErrorCodes.INVALID_PART_ID),
    400,
    ErrorCodes.INVALID_PART_ID,
  );
  check('requireId returns the number when it is one', requireId('12', ErrorCodes.INVALID_PART_ID), 12);

  process.exit(report() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
