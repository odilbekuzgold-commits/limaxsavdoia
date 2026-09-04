import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import { runMigrations, createRepositories, type Repositories } from '../../packages/database/dist/index.js';
import { AIOrchestrator } from '../../packages/ai-engine/dist/index.js';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  getSpreadsheetId,
} from '../../packages/integrations/dist/index.js';

const TEST_DB_URL =
  process.env.LIMAX_TEST_DATABASE_URL ||
  'postgresql://postgres:1111@localhost:5432/limax_test';

describe('Stage 17.4: PostgreSQL Master Runtime & Google Sheets Integration', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  let orchestrator: AIOrchestrator;

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 10 });
    try {
      await pool.query('SELECT 1');
      await runMigrations(pool);
      repos = createRepositories('postgres', pool);

      orchestrator = new AIOrchestrator({
        aiMode: 'mock',
        repos,
      });

      const client = new GoogleSheetsClient({
        spreadsheetId: getSpreadsheetId(),
      });
      const engine = new GoogleSheetsSyncEngine(client, repos, 'postgres', pool);
      await engine.runSync({ dryRun: false, applyCorrections: true, force: true });
    } catch (err) {
      console.warn('PostgreSQL test setup error:', err);
    }
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('1. PostgreSQL Pricing: 40100K BLACK asks payment type first', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K BLACK narxi qancha?');
    assert.ok(res.replyText.includes('naqd') && res.replyText.includes('o‘tkazma'));
    assert.ok(!res.replyText.includes('2.39') && !res.replyText.includes('2.50'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('2. PostgreSQL Pricing: 40100K BLACK naqd returns strictly 2.50 USD/kg', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K BLACK naqd narxi qancha?');
    assert.ok(res.replyText.includes('2.50') || res.replyText.includes('2.5'));
    assert.ok(!res.replyText.includes('2.39'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('3. PostgreSQL Pricing: 40100K BLACK o‘tkazmaga returns strictly 2.39 USD/kg', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K BLACK o‘tkazmaga narxi qancha?');
    assert.ok(res.replyText.includes('2.39'));
    assert.ok(!res.replyText.includes('2.50') && !res.replyText.includes('2.5 '));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('4. Product Ambiguity: "300lik poliester kerak" asks 300D/96 vs W300D/96', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('300lik poliester kerak');
    assert.ok(res.replyText.includes('300D/96') && res.replyText.includes('W300D/96'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('5. Color Ambiguity: "300D/96 narxi qancha?" asks BLACK vs WHITE', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('300D/96 narxi qancha?');
    assert.ok(res.replyText.includes('BLACK') && res.replyText.includes('WHITE'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('6. MOQ Rule: Standard product 40100K BLACK states no MOQ', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K BLACK minimal qancha?');
    assert.ok(res.replyText.includes('yo‘q') || res.replyText.includes('yoq') || res.replyText.includes('cheklanmagan'));
    assert.ok(!res.replyText.includes('1 kg') && !res.replyText.includes('500 kg'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('7. Stock Availability: 300D/96 BLACK returns available without stock numbers or UNKNOWN', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('300D/96 BLACK bormi?');
    assert.ok(res.replyText.includes('mavjud'));
    assert.ok(!res.replyText.toLowerCase().includes('mavjud emas'));
    assert.ok(!res.replyText.includes('kg mavjud'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('8. Source Fidelity: 40100K is preserved exactly', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K BLACK narxi qancha?');
    assert.ok(res.replyText.includes('40100K'));
    assert.ok(!res.replyText.includes('40/100K'));
  });

  it('9. Business Rules: Free samples and 2-year warranty', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const sampleRes = await orchestrator.processQuery('Namunalar bormi?');
    assert.ok(sampleRes.replyText.includes('bepul namunalar'));

    const warrantyRes = await orchestrator.processQuery('Kafolati qancha?');
    assert.ok(warrantyRes.replyText.includes('2 yil kafolat'));
  });
});
