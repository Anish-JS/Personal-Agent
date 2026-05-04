import pg from 'pg';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return _pool;
}

// Convenience alias
export const db = {
  query: (text: string, params?: unknown[]) => getDb().query(text, params),
};
