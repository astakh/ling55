/**
 * Пул соединений с удалённым PostgreSQL (DATABASE_URL из .env) и хелперы запросов.
 */
import pg from 'pg';
import crypto from 'crypto';
import { logger } from './logger.js';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  logger.warn('DB', 'DATABASE_URL не задан — приложение без БД работать не будет. Скопируйте .env.example в .env.');
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  ssl: process.env.PGSSLROOTCERT === 'disable' ? false : undefined,
});

pool.on('error', (err) => {
  logger.error('DB', 'Idle pool client error', { message: err.message });
});

// Колонки DATE возвращать строкой 'YYYY-MM-DD', а не объектом Date
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string | null) => v);

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function exec(text: string, params?: any[]): Promise<number> {
  const res = await pool.query(text, params);
  return res.rowCount ?? 0;
}

/** Выполняет fn(client) внутри транзакции (BEGIN / COMMIT / ROLLBACK). */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Блокировка языкового профиля на время формирования урока
 * (advisory lock, ключ = первые 63 бита sha256 от profileId).
 * Если блокировка уже занята — locked=false (параллельный запрос урока).
 */
export async function withProfileLock<T>(
  profileId: string,
  fn: () => Promise<T>
): Promise<{ locked: boolean; result?: T }> {
  const key = Number(BigInt('0x' + crypto.createHash('sha256').update(profileId).digest('hex').slice(0, 15)));
  const client = await pool.connect();
  try {
    const got = await client.query('SELECT pg_try_advisory_lock($1)', [key]);
    if (!got.rows[0].pg_try_advisory_lock) {
      return { locked: false };
    }
    try {
      const result = await fn();
      return { locked: true, result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Закрытие пула соединений (graceful shutdown). */
export async function closePool(): Promise<void> {
  await pool.end();
}
