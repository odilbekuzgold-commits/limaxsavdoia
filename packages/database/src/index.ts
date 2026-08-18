import pg from 'pg';
import type { Repositories } from '@limax/shared';
import { createRepositories, type RepositoryDriver } from './repositories/index.js';

const { Pool } = pg;

export type DatabaseHealthStatus = {
  status: 'ok' | 'unavailable';
  latencyMs?: number;
  error?: string;
};

let _pool: pg.Pool | null = null;

export function getDbPool(connectionString?: string): pg.Pool {
  if (_pool) return _pool;

  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set for PostgreSQL connection pool.');
  }

  _pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20,
    statement_timeout: 10000,
  });

  _pool.on('error', (err) => {
    console.error('[PostgreSQL Pool Error]', err.message);
  });

  return _pool;
}

export async function closeDbPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export async function checkDatabaseHealth(
  timeoutMs = 3000,
): Promise<DatabaseHealthStatus> {
  const pool = getDbPool();
  const start = Date.now();

  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
      ),
    ]);

    try {
      await client.query('SELECT 1');
      return {
        status: 'ok',
        latencyMs: Date.now() - start,
      };
    } finally {
      client.release();
    }
  } catch {
    return {
      status: 'unavailable',
      error: 'PostgreSQL connection failed',
    };
  }
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export async function runMigrations(customPool?: pg.Pool): Promise<void> {
  const pool = customPool || getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const { rows: existing } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations',
    );
    const executedNames = new Set(existing.map((r) => r.name));

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    let migrationsDir = path.join(__dirname, 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      const srcDir = path.join(__dirname, '..', 'src', 'migrations');
      if (fs.existsSync(srcDir)) {
        migrationsDir = srcDir;
      }
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const name = path.basename(file, '.sql');
      if (!executedNames.has(name)) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');
        try {
          await client.query('SAVEPOINT mig_sp');
          await client.query(sql);
          await client.query('RELEASE SAVEPOINT mig_sp');
        } catch (migErr: unknown) {
          await client.query('ROLLBACK TO SAVEPOINT mig_sp');
          const msg = migErr instanceof Error ? migErr.message : String(migErr);
          console.error(`[Database Migration Error] Migration ${name} failed: ${msg}`);
          throw new Error(`Migration ${name} failed: ${msg}`);
        }

        await client.query(
          'INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [name]
        );
        console.log(`[Database Migration] Applied: ${name}`);
      }
    }

    await client.query('COMMIT');
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Database Migration Error]', msg);
    throw err;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  driver: RepositoryDriver,
  pool: pg.Pool | undefined,
  repos: Repositories,
  fn: (txRepos: Repositories, client?: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (driver === 'postgres') {
    if (!pool) {
      throw new Error('PostgreSQL pool is required for transaction execution');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txRepos = createRepositories('postgres', client);
      const result = await fn(txRepos, client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return fn(repos);
}

// Re-export repository layer
export * from './repositories/index.js';
export * from './importers/knowledge-import.js';
export * from './importers/business-data.schema.js';
export * from './importers/business-data-importer.js';
