import pg from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';

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
