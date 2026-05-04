import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

let _pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on('error', (err) => {
      console.error('Postgres pool error:', err);
    });
  }
  return _pool;
}

export const db = {
  query: (text: string, params?: unknown[]) => getDb().query(text, params),
};
