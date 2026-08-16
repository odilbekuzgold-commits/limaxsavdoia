import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { runMigrations } from '../../packages/database/dist/index.js';

describe('Stage 10.1: Safety Regression & URL Validation Tests', () => {
  function validateTestUrl(urlStr: string | undefined): { allowed: boolean; reason?: string } {
    if (!urlStr) {
      return { allowed: false, reason: 'LIMAX_TEST_DATABASE_URL environment variable is missing' };
    }
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { allowed: false, reason: 'LIMAX_TEST_DATABASE_URL is not a valid URL' };
    }

    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      return { allowed: false, reason: `Invalid protocol ${parsed.protocol}` };
    }
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return { allowed: false, reason: `Remote host ${parsed.hostname} rejected` };
    }
    const dbName = parsed.pathname.replace('/', '');
    if (dbName !== 'limax_test' && !dbName.startsWith('limax_test_')) {
      return { allowed: false, reason: `Database ${dbName} is not a test database` };
    }

    return { allowed: true };
  }

  it('1. LIMAX_TEST_DATABASE_URL missing -> test is skipped / rejected', () => {
    const res = validateTestUrl(undefined);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason?.includes('missing'));
  });

  it('2. Standard DATABASE_URL is NOT used by integration test', () => {
    const integrationPath = resolve(process.cwd(), 'tests/integration/pg_handoff_delivery_persistence.test.ts');
    const content = readFileSync(integrationPath, 'utf8');
    assert.strictEqual(content.includes('process.env.DATABASE_URL'), false, 'Integration test must NOT contain process.env.DATABASE_URL');
  });

  it('3. Remote host URL -> rejected by safety validator', () => {
    const res = validateTestUrl('postgresql://user:pass@remote-db.example.com:5432/limax_test');
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason?.includes('Remote host'));
  });

  it('4. Production/dev database limax_db -> rejected by safety validator', () => {
    const res = validateTestUrl('postgresql://user:pass@127.0.0.1:5432/limax_db');
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason?.includes('is not a test database'));
  });

  it('5. Database limax_test -> accepted by safety validator', () => {
    const res = validateTestUrl('postgresql://postgres:postgres@127.0.0.1:5432/limax_test');
    assert.strictEqual(res.allowed, true);
  });

  it('6. Database limax_test_stage10 -> accepted by safety validator', () => {
    const res = validateTestUrl('postgresql://postgres:postgres@localhost:5432/limax_test_stage10');
    assert.strictEqual(res.allowed, true);
  });

  it('7. Malformed URL -> rejected cleanly without leaking credentials', () => {
    const res = validateTestUrl('invalid-url-with-secret-pass1234');
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.reason?.includes('secret-pass1234'), false);
  });

  it('8. Migration 007 scopes CHECK constraint strictly to public.handoffs', () => {
    const migPath = resolve(process.cwd(), 'packages/database/src/migrations/007_handoff_schema_alignment.sql');
    const content = readFileSync(migPath, 'utf8');
    assert.ok(content.includes("conrelid = 'public.handoffs'::regclass"), 'Constraint check must be scoped to public.handoffs');
  });

  it('9. Migration 007 contains non-destructive duplicate PENDING preflight', () => {
    const migPath = resolve(process.cwd(), 'packages/database/src/migrations/007_handoff_schema_alignment.sql');
    const content = readFileSync(migPath, 'utf8');
    assert.ok(content.includes('HAVING COUNT(*) > 1'), 'Preflight must search for duplicate PENDING count');
    assert.ok(content.includes('RAISE EXCEPTION'), 'Preflight must raise exception on duplicates');
    assert.strictEqual(content.includes('DELETE FROM'), false, 'Migration 007 must NOT perform destructive DELETE');
  });

  it('10. Migration 007 defines partial unique index for PENDING status', () => {
    const migPath = resolve(process.cwd(), 'packages/database/src/migrations/007_handoff_schema_alignment.sql');
    const content = readFileSync(migPath, 'utf8');
    assert.ok(content.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_handoffs_conversation_pending'));
    assert.ok(content.includes("WHERE status = 'PENDING'"));
  });

  it('11. Source code contains ZERO references to fake vector fallback types or functions', () => {
    const dbIndexPath = resolve(process.cwd(), 'packages/database/src/index.ts');
    const content = readFileSync(dbIndexPath, 'utf8');
    assert.strictEqual(content.includes('CREATE TYPE vector'), false, 'Source must NOT contain CREATE TYPE vector');
    assert.strictEqual(content.includes('vector_in'), false, 'Source must NOT contain vector_in');
    assert.strictEqual(content.includes('vector_out'), false, 'Source must NOT contain vector_out');
    assert.strictEqual(content.includes('vector_typmod_in'), false, 'Source must NOT contain vector_typmod_in');
    assert.strictEqual(content.includes('vector_typmod_out'), false, 'Source must NOT contain vector_typmod_out');
    assert.strictEqual(content.includes('pure SQL vector fallback'), false, 'Source must NOT contain fake fallback log');
  });

  it('12. Fail-Fast: missing pgvector fails migration 001, writes ZERO items to ledger, and halts 002-007', async () => {
    const executedLedger: string[] = [];
    const attemptedFiles: string[] = [];

    const mockClient = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT name FROM _migrations')) {
          return { rows: [] };
        }
        if (sql.includes('CREATE EXTENSION IF NOT EXISTS vector')) {
          attemptedFiles.push('001_pgvector_extension');
          const err: any = new Error('extension "vector" is not available');
          err.code = '0A000';
          throw err;
        }
        if (sql.includes('INSERT INTO _migrations')) {
          executedLedger.push(values?.[0] as string);
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as unknown as pg.Pool;

    let thrownErr: any = null;
    try {
      await runMigrations(mockPool);
    } catch (err) {
      thrownErr = err;
    }

    assert.ok(thrownErr, 'runMigrations must throw error when migration 001 fails');
    assert.ok(thrownErr.message.includes('001_pgvector_extension'), 'Error must specify migration 001 name');
    assert.strictEqual(executedLedger.length, 0, 'Ledger must contain ZERO executed migrations when 001 fails');
    assert.strictEqual(attemptedFiles.length, 1, 'Only 001 should have been attempted; 002-007 must NOT run');
  });
});
