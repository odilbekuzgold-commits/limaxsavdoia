import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import { runMigrations, createRepositories, type Repositories } from '../../packages/database/dist/index.js';
import { AIOrchestrator } from '../../packages/ai-engine/dist/index.js';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  REQUIRED_SPREADSHEET_ID,
} from '../../packages/integrations/dist/index.js';

const TEST_DB_URL =
  process.env.LIMAX_TEST_DATABASE_URL ||
  'postgresql://postgres:1111@localhost:5432/limax_test';

describe('Stage 17.3: PostgreSQL Conversation Truth & Real Source Reconciliation', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  let orchestrator: AIOrchestrator;

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 10 });
    try {
      await pool.query('SELECT 1');
      await runMigrations(pool);
      await pool.query('DELETE FROM product_prices');
      await pool.query('DELETE FROM product_inventory');
      await pool.query('DELETE FROM products');
      await pool.query('DELETE FROM google_sheets_sync_state');
      repos = createRepositories('postgres', pool);

      orchestrator = new AIOrchestrator({
        aiMode: 'mock',
        repos,
      });

      // Run Google Sheets Sync with Stage 17.2/17.3 corrections
      const client = new GoogleSheetsClient({
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
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

  it('1. Database schema: product_prices.minimum_quantity is nullable in PostgreSQL', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const { rows } = await pool.query(`
      SELECT is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'product_prices' 
        AND column_name = 'minimum_quantity'
    `);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].is_nullable, 'YES', 'minimum_quantity must be nullable');
  });

  it('2. 85 Active Google Sheets Products and 170 Prices loaded in PostgreSQL', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const { rows: prods } = await pool.query('SELECT count(*) FROM products WHERE source_system = $1 AND active = true', ['GOOGLE_SHEETS']);
    assert.ok(parseInt(prods[0].count, 10) >= 85, 'Must have at least 85 active Google Sheets products');

    const { rows: prices } = await pool.query('SELECT count(*) FROM product_prices WHERE source_system = $1 AND active = true', ['GOOGLE_SHEETS']);
    assert.ok(parseInt(prices[0].count, 10) >= 170, 'Must have at least 170 active Google Sheets prices');
  });

  it('3. Real runtime asks payment type before returning 40100K price', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K narxi qancha?');
    assert.ok(res.replyText.includes('naqd') && res.replyText.includes('o‘tkazma'));
    assert.ok(!res.replyText.includes('2.39') && !res.replyText.includes('2.50'));
    assert.ok(!res.replyText.includes('MOQ') && !res.replyText.includes('Minimal buyurtma'), 'No MOQ when null in DB');
    assert.strictEqual(res.needsHandoff, false);
  });

  it('4. Real runtime "40100K naqd" returns only 2.50 USD/kg', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K naqd narxi qancha?');
    assert.ok(res.replyText.includes('2.50') || res.replyText.includes('2.5'));
    assert.ok(!res.replyText.includes('2.39'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('5. Real runtime "40100K o‘tkazma" returns only 2.39 USD/kg', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K o‘tkazmaga narxi qancha?');
    assert.ok(res.replyText.includes('2.39'));
    assert.ok(!res.replyText.includes('2.50') && !res.replyText.includes('2.5 '));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('6. Real runtime "Sen AI misan?" returns assistant identity without handoff', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('Sen AI misan?');
    assert.strictEqual(res.replyText, 'Nega bunday deyapsiz?');
    assert.strictEqual(res.needsHandoff, false);
    assert.strictEqual(res.intent, 'bot_identity');
  });

  it('7. Real runtime "300 lik poliester" clarifies product/color options', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('300 lik poliester narxi qancha?');
    assert.ok(
      res.replyText.includes('300D') ||
      res.replyText.includes('W300D') ||
      res.replyText.includes('BLACK') ||
      res.replyText.includes('WHITE')
    );
    assert.strictEqual(res.needsHandoff, false);
  });

  it('8. Real runtime UNKNOWN inventory returns unconfirmed stock message without "mavjud emas"', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await orchestrator.processQuery('40100K omborda bormi?');
    assert.ok(!res.replyText.toLowerCase().includes('mavjud emas'));
    assert.ok(!res.replyText.toLowerCase().includes('нет в наличии'));
    assert.ok(res.replyText.includes('mavjud') || res.replyText.includes('kiritilmagan') || res.replyText.includes('aniqlanmagan') || res.replyText.includes('uzatiladi'));
  });
});
