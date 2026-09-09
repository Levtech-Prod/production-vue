import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

/** Anything that can run a parameterized query — the pool or a tx client.
 *  Lives here rather than in a service so both file services and the routes
 *  that take a `db` parameter can name it without importing each other. */
export interface Queryable {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params: unknown[] = [],
) {
  const result = await pool.query<T>(text, params);
  return result;
}

/**
 * Run `fn` inside one transaction and hand back whatever it returns.
 *
 * The rollback is the point: every throw rolls back and releases, including an
 * `ApiError` raised to answer 404 or 409, so no handler has to remember to
 * unwind on each of its own exits. Work that a rollback could not undo — an
 * unlink, sending the response — belongs after this call, not inside it.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // A rollback that fails — a dropped connection, normally — must not
    // replace the error that caused it, which is the one worth reading.
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The `code` of a Postgres error, or undefined for anything else. */
function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: unknown }).code as string | undefined
    : undefined;
}

/** A unique index rejected the write (SQLSTATE 23505) — the constraint doing
 *  the work a route would otherwise pre-check with a racy SELECT. */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23505';
}

/** A foreign key rejected the write (23503): either the row points at
 *  something that does not exist, or something still points at it. */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === '23503';
}

/**
 * Which unique index a write violated, for the routes that map two indexes on
 * one table to two different codes.
 *
 * Gated on 23505 rather than reading `constraint` from any error: a CHECK or
 * exclusion constraint sharing the name would otherwise be answered as a
 * duplicate, which is a different thing and a different status.
 */
export function violatedUniqueConstraint(err: unknown): string | undefined {
  if (!isUniqueViolation(err)) return undefined;
  return typeof err === 'object' && err !== null && 'constraint' in err
    ? (err as { constraint?: unknown }).constraint as string | undefined
    : undefined;
}
