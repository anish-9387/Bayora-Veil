import pg from 'pg';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import type { QueryResult, QueryResultRow, PoolClient, PoolConfig } from 'pg';

// pnpm runs API scripts from apps/api; resolve the root .env independently of cwd.
const envPath = resolve(__dirname, '../../../../.env');
if (process.env.NODE_ENV !== 'production' && existsSync(envPath)) loadEnvFile(envPath);

const { Pool } = pg;

const poolConfig: PoolConfig = {
  ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'bayora_veil',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 15000
};
if (process.env.DATABASE_URL) {
  for (const key of ['host', 'port', 'database', 'user', 'password'] as const) delete poolConfig[key];
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected database pool error', err);
});

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }
  return result;
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { pool };
