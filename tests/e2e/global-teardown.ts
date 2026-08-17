/**
 * LImax Stage 14.3 — Playwright Global Teardown
 *
 * Responsibilities:
 *  1. Stop API and Dashboard processes (SIGTERM).
 *  2. Verify temp DB name starts with limax_test_stage14_3_.
 *  3. Drop temp DB.
 *  4. Remove state file.
 *
 * Never touches non-test resources.
 */

import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname2, '../..');

const STATE_FILE = resolve('.playwright-e2e-state.json');

function log(msg: string) {
  process.stdout.write(`[E2E Teardown] ${msg}\n`);
}

async function killPid(pid: number | undefined, name: string) {
  if (!pid) {
    log(`${name} PID not found, skipping.`);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    log(`${name} (PID ${pid}) stopped.`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // If process is already dead, that's fine.
    if (!msg.includes('ESRCH')) {
      log(`Warning: Could not stop ${name} (PID ${pid}): ${msg}`);
    }
  }
}

export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) {
    log('State file not found. Nothing to teardown.');
    return;
  }

  let state: {
    apiPid?: number;
    dashPid?: number;
    tempDbName?: string;
    tempDbUrl?: string;
    adminUrl?: string;
  };

  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    log('State file could not be parsed. Skipping teardown.');
    return;
  }

  // 1. Stop servers
  await killPid(state.apiPid, 'API server');
  await killPid(state.dashPid, 'Dashboard server');

  // Brief wait for ports to release
  await new Promise((r) => setTimeout(r, 1500));

  // 2. Verify and drop temp DB
  const { tempDbName, adminUrl } = state;
  if (!tempDbName) {
    log('No temp DB name in state. Skipping DB drop.');
  } else if (!tempDbName.startsWith('limax_test_stage14_3_')) {
    // Safety: never drop a non-test database
    throw new Error(
      `[E2E Teardown] SAFETY ABORT: tempDbName "${tempDbName}" does not start with limax_test_stage14_3_. Refusing to drop DB.`
    );
  } else {
    log(`Dropping temp DB: ${tempDbName}`);
    const pgPath = resolve(PROJECT_ROOT, 'packages/database/node_modules/pg/lib/index.js');
    const { default: pg } = await import(pgPath);
    const adminPool = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 3000 });
    try {
      // Terminate active connections to the temp DB before dropping
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [tempDbName]
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
      log(`Temp DB "${tempDbName}" dropped ✅`);
    } catch (e) {
      log(`Warning: Could not drop temp DB "${tempDbName}": ${e instanceof Error ? e.message : String(e)}`);
      throw e; // Re-throw so teardown failure is visible
    } finally {
      await adminPool.end();
    }
  }

  // 3. Remove state file
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // Best-effort
  }

  log('Global teardown complete ✅');
}
