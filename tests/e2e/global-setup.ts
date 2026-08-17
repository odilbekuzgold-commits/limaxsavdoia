/**
 * LImax Stage 14.3 — Playwright Global Setup
 *
 * Responsibilities:
 *  1. Validate LIMAX_TEST_DATABASE_URL (host + db name safety).
 *  2. Create isolated temp DB: limax_test_stage14_3_<timestamp>.
 *  3. Apply all 12 migrations and verify ledger count.
 *  4. Generate runtime secrets (INTERNAL_API_TOKEN, DASHBOARD_USER, DASHBOARD_PASSWORD).
 *  5. Start API server on port 4001 with TELEGRAM_UPDATE_MODE=disabled.
 *  6. Wait for /health/live and /health/ready (200).
 *  7. Start Dashboard server (next start) on port 3100.
 *  8. Wait for Dashboard to respond.
 *  9. Store PIDs and temp DB name to state file for teardown.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

const STATE_FILE = resolve('.playwright-e2e-state.json');

const E2E_API_PORT = parseInt(process.env.E2E_API_PORT ?? '4001', 10);
const E2E_DASHBOARD_PORT = parseInt(process.env.E2E_DASHBOARD_PORT ?? '3100', 10);

// Project root
const PROJECT_ROOT = resolve('.');

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`[E2E Setup] ${msg}\n`);
}

function safeToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function safePassword(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

async function waitForHttp(
  url: string,
  timeoutMs: number,
  expectedStatus?: number,
  retryMs = 1000
): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (expectedStatus !== undefined) {
        if (res.status === expectedStatus) return;
      } else {
        if (res.status < 500) return;
      }
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, retryMs));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for ${url}. Last error: ${lastErr}`);
}

// ── Main Setup ────────────────────────────────────────────────────────────────

export default async function globalSetup() {
  // 1. Validate LIMAX_TEST_DATABASE_URL
  const testDbUrl = process.env.LIMAX_TEST_DATABASE_URL;
  if (!testDbUrl) {
    throw new Error(
      '[E2E Setup] LIMAX_TEST_DATABASE_URL is not set. Cannot run E2E tests against production DB.'
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(testDbUrl);
  } catch {
    throw new Error('[E2E Setup] LIMAX_TEST_DATABASE_URL is not a valid URL.');
  }

  const host = parsedUrl.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      `[E2E Setup] Remote host "${host}" rejected by safety rule. Must be 127.0.0.1 or localhost.`
    );
  }

  const protocol = parsedUrl.protocol;
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    throw new Error(
      `[E2E Setup] Invalid protocol "${protocol}". Must be postgresql: or postgres:.`
    );
  }

  // 2. Create isolated temp DB
  const timestamp = Date.now();
  const tempDbName = `limax_test_stage14_3_${timestamp}`;
  const adminUrl = `${parsedUrl.protocol}//${parsedUrl.username}:${parsedUrl.password}@${parsedUrl.hostname}:${parsedUrl.port || '5432'}/postgres`;
  const tempDbUrl = `${parsedUrl.protocol}//${parsedUrl.username}:${parsedUrl.password}@${parsedUrl.hostname}:${parsedUrl.port || '5432'}/${tempDbName}`;

  log(`Creating temp database: ${tempDbName}`);

  // Dynamic imports to avoid issues with module resolution
  const pgPath = resolve(PROJECT_ROOT, 'packages/database/node_modules/pg/lib/index.js');
  const { default: pg } = await import(pgPath);

  const adminPool = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  try {
    await adminPool.query(`CREATE DATABASE "${tempDbName}"`);
    log(`Temp database "${tempDbName}" created ✅`);
  } finally {
    await adminPool.end();
  }

  // 3. Apply migrations
  log('Applying migrations 001-012...');
  const dbDistPath = resolve(PROJECT_ROOT, 'packages/database/dist/index.js');
  const { runMigrations } = await import(dbDistPath);
  const testPool = new pg.Pool({ connectionString: tempDbUrl });
  try {
    await runMigrations(testPool);

    // Verify ledger count
    const ledgerRes = await testPool.query('SELECT COUNT(*) as cnt FROM _migrations');
    const ledgerCount = parseInt(ledgerRes.rows[0].cnt, 10);
    if (ledgerCount !== 12) {
      throw new Error(`Expected 12 migrations in ledger, got ${ledgerCount}.`);
    }
    log(`Migrations applied. Ledger: ${ledgerCount} ✅`);
  } finally {
    await testPool.end();
  }

  // 4. Generate runtime secrets — never hardcoded, never logged
  const internalToken = safeToken(32);
  const dashUser = 'limax_e2e_user';
  const dashPassword = safePassword(16);

  // Expose to test process env
  process.env.E2E_TEMP_DB_NAME = tempDbName;
  process.env.E2E_TEMP_DB_URL = tempDbUrl;
  process.env.INTERNAL_API_TOKEN = internalToken;
  process.env.E2E_DASHBOARD_USER = dashUser;
  process.env.E2E_DASHBOARD_PASSWORD = dashPassword;

  // 5. Start API server
  log(`Starting API server on port ${E2E_API_PORT}...`);
  const apiEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    REPOSITORY_DRIVER: 'postgres',
    DATABASE_URL: tempDbUrl,
    API_PORT: String(E2E_API_PORT),
    INTERNAL_API_TOKEN: internalToken,
    TELEGRAM_UPDATE_MODE: 'disabled',
    TELEGRAM_BOT_TOKEN: 'DISABLED_FOR_E2E',
    AI_MODE: 'mock',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    CORS_ORIGINS: `http://127.0.0.1:${E2E_DASHBOARD_PORT}`,
    LOG_LEVEL: 'warn',
    // Safety: prevent accidental production DB use
    LIMAX_TEST_DATABASE_URL: '',
    E2E_TEMP_DB_URL: '',
  };

  const apiProc = spawn(
    process.execPath,
    [resolve(PROJECT_ROOT, 'apps/api/dist/index.js')],
    {
      env: apiEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: resolve(PROJECT_ROOT, 'apps/api'),
    }
  );

  apiProc.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().replace(internalToken, '[REDACTED]').replace(dashPassword, '[REDACTED]').trim();
    if (line) process.stderr.write(`[API] ${line}\n`);
  });
  apiProc.on('error', (e) => process.stderr.write(`[API spawn error] ${e.message}\n`));

  await waitForHttp(`http://127.0.0.1:${E2E_API_PORT}/health/live`, 30_000);
  log(`API /health/live OK ✅`);

  // Verify PostgreSQL connectivity via direct health check (Redis optional in E2E)
  const pgHealthRes = await fetch(`http://127.0.0.1:${E2E_API_PORT}/health/ready`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  const pgHealthBody = pgHealthRes ? await pgHealthRes.json().catch(() => ({})) : {};
  if (pgHealthBody?.services?.postgresql !== 'ok') {
    throw new Error(`[E2E Setup] PostgreSQL is not ready. Health response: ${JSON.stringify(pgHealthBody)}`);
  }
  log(`API PostgreSQL ready ✅`);

  // 6. Start Dashboard server using `next start`
  log(`Starting Dashboard server on port ${E2E_DASHBOARD_PORT}...`);
  const dashboardDir = resolve(PROJECT_ROOT, 'apps/dashboard');
  // next binary lives in dashboard's own node_modules (pnpm hoisting)
  const nextBin = resolve(dashboardDir, 'node_modules/.bin/next.CMD');

  const dashEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(E2E_DASHBOARD_PORT),
    DASHBOARD_API_URL: `http://127.0.0.1:${E2E_API_PORT}`,
    INTERNAL_API_TOKEN: internalToken,
    DASHBOARD_USER: dashUser,
    DASHBOARD_PASSWORD: dashPassword,
    LOG_LEVEL: 'warn',
    // Safety: prevent production DB exposure to dashboard process
    DATABASE_URL: '',
    LIMAX_TEST_DATABASE_URL: '',
    E2E_TEMP_DB_URL: '',
  };

  const dashProc = spawn(
    'cmd.exe',
    ['/c', nextBin, 'start', '--port', String(E2E_DASHBOARD_PORT)],
    {
      env: dashEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: dashboardDir,
    }
  );

  dashProc.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().replace(internalToken, '[REDACTED]').replace(dashPassword, '[REDACTED]').trim();
    if (line) process.stderr.write(`[Dashboard] ${line}\n`);
  });
  dashProc.on('error', (e) => process.stderr.write(`[Dashboard spawn error] ${e.message}\n`));

  await waitForHttp(`http://127.0.0.1:${E2E_DASHBOARD_PORT}`, 30_000);
  log(`Dashboard OK ✅`);

  // 7. Save state for teardown and tests
  const state = {
    apiPid: apiProc.pid,
    dashPid: dashProc.pid,
    tempDbName,
    tempDbUrl,
    adminUrl,
    internalToken,
    dashUser,
    dashPassword,
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

  log('Global setup complete ✅');
}
