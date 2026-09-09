// ===========================================================================
// `withTransaction` and the Postgres error predicates — the helpers the route
// refactor put underneath 40 hand-rolled transactions and 24 constraint
// mappings. Every one of those call sites now depends on this file behaving
// exactly as described, and a mistake here is silent: a transaction that
// commits when it should roll back leaves bad data and no error.
//
// Runs against a FAKE client, so it needs no database and no .env.
// Run: npm run test:unit
// ===========================================================================
import type { PoolClient } from 'pg';
import {
  pool,
  withTransaction,
  isUniqueViolation,
  isForeignKeyViolation,
  violatedUniqueConstraint,
} from './db.js';
import { ApiError } from './apiError.js';
import { ErrorCodes } from './errorCodes.js';
import { check, checkRefuses, report } from './testing/check.js';

interface FakeClient {
  statements: string[];
  released: number;
  destroyed: boolean;
}

/**
 * Stand in for a pooled client, recording the statements it was sent and how
 * it was released. `failOn` makes one statement throw, which is how the
 * rollback paths are reached without a database.
 */
function fakeClient(failOn?: string): { client: PoolClient; log: FakeClient } {
  const log: FakeClient = { statements: [], released: 0, destroyed: false };
  const client = {
    query: async (text: string) => {
      log.statements.push(text);
      if (failOn && text === failOn) throw new Error(`boom: ${text}`);
      return { rows: [], rowCount: 0 };
    },
    release: (destroy?: boolean | Error) => {
      log.released++;
      if (destroy) log.destroyed = true;
    },
  };
  return { client: client as unknown as PoolClient, log };
}

/** Point the pool at a fake for one call, then restore it. */
async function withFakePool<T>(
  client: PoolClient,
  run: () => Promise<T>,
): Promise<T> {
  const original = pool.connect;
  pool.connect = (async () => client) as typeof pool.connect;
  try {
    return await run();
  } finally {
    pool.connect = original;
  }
}

async function main() {
  // --- the happy path -----------------------------------------------------
  {
    const { client, log } = fakeClient();
    const result = await withFakePool(client, () =>
      withTransaction(async () => 'payload'),
    );
    check('commits and returns what the callback returned', result, 'payload');
    check('BEGIN then COMMIT, nothing else', log.statements, ['BEGIN', 'COMMIT']);
    check('the client is released exactly once', log.released, 1);
    check('and kept in the pool', log.destroyed, false);
  }

  // --- a throwing callback: the reason the helper exists -------------------
  {
    const { client, log } = fakeClient();
    await checkRefuses(
      'an ApiError from the callback reaches the caller',
      () =>
        withFakePool(client, () =>
          withTransaction(async () => {
            throw new ApiError(409, ErrorCodes.PROJECT_NOT_EDITABLE);
          }),
        ),
      409,
      ErrorCodes.PROJECT_NOT_EDITABLE,
    );
    check('and it rolled back rather than committed', log.statements, ['BEGIN', 'ROLLBACK']);
    check('the client is still released', log.released, 1);
    check('and is still reusable', log.destroyed, false);
  }

  // --- a returned value commits, a thrown one does not --------------------
  // The distinction every converted handler now relies on: the "already set,
  // skip the write" paths return, every refusal throws.
  {
    const { client, log } = fakeClient();
    await withFakePool(client, () => withTransaction(async () => undefined));
    check('returning undefined still commits', log.statements, ['BEGIN', 'COMMIT']);
  }

  // --- a failing COMMIT rolls back ----------------------------------------
  {
    const { client, log } = fakeClient('COMMIT');
    let caught: unknown;
    try {
      await withFakePool(client, () => withTransaction(async () => 'x'));
    } catch (err) {
      caught = err;
    }
    check('a failed COMMIT surfaces', String(caught), 'Error: boom: COMMIT');
    check('and is rolled back', log.statements, ['BEGIN', 'COMMIT', 'ROLLBACK']);
  }

  // --- a failing ROLLBACK must not mask the real error, and must not put a
  // --- possibly-open connection back into the pool ------------------------
  {
    const { client, log } = fakeClient('ROLLBACK');
    let caught: unknown;
    try {
      await withFakePool(client, () =>
        withTransaction(async () => {
          throw new Error('the real problem');
        }),
      );
    } catch (err) {
      caught = err;
    }
    check('the original error survives a failed rollback', String(caught), 'Error: the real problem');
    check('the suspect connection is destroyed, not pooled', log.destroyed, true);
    check('and it is still released', log.released, 1);
  }

  // --- the predicates -----------------------------------------------------
  check('23505 is a unique violation', isUniqueViolation({ code: '23505' }), true);
  check('23503 is not', isUniqueViolation({ code: '23503' }), false);
  check('23503 is a foreign key violation', isForeignKeyViolation({ code: '23503' }), true);
  check(
    'neither predicate throws on a non-pg error',
    [isUniqueViolation(new Error('x')), isForeignKeyViolation(null), isUniqueViolation(undefined)],
    [false, false, false],
  );
  check(
    'a constraint name only counts on a unique violation',
    violatedUniqueConstraint({ code: '23505', constraint: 'ux_a' }),
    'ux_a',
  );
  check(
    'a CHECK violation sharing the name is not read as a duplicate',
    violatedUniqueConstraint({ code: '23514', constraint: 'ux_a' }),
    undefined,
  );

  process.exit(report() === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
