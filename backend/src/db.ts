import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

export async function query<T = any>(text: string, params: unknown[] = []) {
  const result = await pool.query<T>(text, params);
  return result;
}
