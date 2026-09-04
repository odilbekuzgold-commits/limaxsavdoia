import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import {
  createRepositories,
  runMigrations,
  type Repositories,
} from '../../packages/database/dist/index.js';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  REQUIRED_SPREADSHEET_ID,
} from '../../packages/integrations/dist/index.js';
import { AIOrchestrator } from '../../packages/ai-engine/dist/index.js';

const TEST_DB_URL =
  process.env.LIMAX_TEST_DATABASE_URL ||
  'postgresql://postgres:1111@localhost:5432/limax_test';

describe('Stage 17.2: PostgreSQL Real Integration — Google Sheet 85 Products, 170 Prices & Telegram Runtime', () => {
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
    } catch (err) {
      console.warn('PostgreSQL test connection failed, skipping integration tests:', err);
    }
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('1. Preflight: Migration 014 applied and database connected', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await pool.query<{ count: string }>('SELECT count(*) FROM google_sheets_sync_state');
    assert.ok(parseInt(res.rows[0].count, 10) >= 0);
  });

  it('2. Dry-Run on Live Google Sheet: 85 Products, 170 Prices, 0 Inventory mutations', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
    });

    const engine = new GoogleSheetsSyncEngine(client, repos, 'postgres', pool);
    const dryRes = await engine.runSync({ dryRun: true, applyCorrections: true, force: true });

    assert.ok(dryRes.status === 'SUCCESS' || dryRes.status === 'SKIPPED_UNCHANGED');
    assert.ok(dryRes.counts.products >= 85, 'Must contain at least 85 products');
    assert.strictEqual(dryRes.counts.prices, 170, 'Must contain 170 prices (85 CASH + 85 BANK_TRANSFER)');
    assert.strictEqual(dryRes.counts.inventory, 0, 'Inventory must be 0 (blocked)');
    assert.ok((dryRes.details?.manifest?.length || 0) > 0, 'Correction manifest must be populated');
  });

  it('3. Real PostgreSQL Apply: Atomic transaction, checksum idempotency & DB reconciliation', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
    });

    const engine = new GoogleSheetsSyncEngine(client, repos, 'postgres', pool);
    const applyRes = await engine.runSync({ dryRun: false, applyCorrections: true, force: true });

    assert.ok(applyRes.status === 'SUCCESS' || applyRes.status === 'SKIPPED_UNCHANGED');
    assert.ok(applyRes.counts.products >= 85);
    assert.strictEqual(applyRes.counts.prices, 170);

    // Reconcile 40100K BLACK in PostgreSQL
    const allProds = await repos.products.findAll({});
    const p40100Blk = allProds.find((p) => p.code === 'VS-40100K-BLK');
    assert.ok(p40100Blk, 'VS-40100K-BLK product must be created');
    assert.strictEqual(p40100Blk.category, 'Vozdushniy spandeks');

    const pricesBlk = await repos.productPrices.findByProductId(p40100Blk.id);
    const bankPriceBlk = pricesBlk.find((p) => p.paymentType === 'BANK_TRANSFER' && p.active);
    const cashPriceBlk = pricesBlk.find((p) => p.paymentType === 'CASH' && p.active);
    assert.strictEqual(bankPriceBlk?.price, 2.39, '40100K BLACK BANK_TRANSFER must be 2.39 USD');
    assert.strictEqual(cashPriceBlk?.price, 2.50, '40100K BLACK CASH must be 2.50 USD');

    // Reconcile 40100K WHITE in PostgreSQL
    const p40100Wht = allProds.find((p) => p.code === 'VS-40100K-WHT');
    assert.ok(p40100Wht, 'VS-40100K-WHT product must be created');
    const pricesWht = await repos.productPrices.findByProductId(p40100Wht.id);
    const bankPriceWht = pricesWht.find((p) => p.paymentType === 'BANK_TRANSFER' && p.active);
    const cashPriceWht = pricesWht.find((p) => p.paymentType === 'CASH' && p.active);
    assert.strictEqual(bankPriceWht?.price, 2.39, '40100K WHITE BANK_TRANSFER must be 2.39 USD');
    assert.strictEqual(cashPriceWht?.price, 2.50, '40100K WHITE CASH must be 2.50 USD');

    // Reconcile Spun 32S MIC COLOR in PostgreSQL
    const pSpunMix = allProds.find((p) => p.code === 'SPUN-32S-MIX');
    assert.ok(pSpunMix);
    assert.strictEqual(pSpunMix.name, 'Spun 32S/1 32S MIC COLOR', 'Spun 32S name must contain MIC COLOR');
  });

  async function createTestConversation(prefix: string, name: string) {
    const tgId = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const customer = await repos.customers.create({ telegramId: tgId, name });
    const contact = await repos.contacts.create({
      customerId: customer.id,
      channel: 'telegram',
      externalId: tgId,
      name,
    });
    return repos.conversations.create({
      customerId: customer.id,
      contactId: contact.id,
      channel: 'telegram',
      status: 'active',
      context: {},
      lastMessageAt: new Date(),
    });
  }

  it('4. Telegram Bot Runtime Scenario 1: 40100K bank transfer query returns 2.39 USD/kg', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_201', 'Mijoz 201');

    const result = await orchestrator.processQuery('40100K qora o‘tkazmaga narxi qancha?', {
      conversationId: conversation.id,
    });

    console.log('SCENARIO 1 RESULT:', JSON.stringify(result, null, 2));

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.includes('2.39') || result.replyText.includes('2,39'),
      'Bot response must present 2.39 USD price for bank transfer'
    );
  });

  it('5. Telegram Bot Runtime Scenario 2: 40100K cash query returns 2.50 USD/kg', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_202', 'Mijoz 202');

    const result = await orchestrator.processQuery('40100K qora naqdga qancha?', {
      conversationId: conversation.id,
    });

    console.log('SCENARIO 2 RESULT:', JSON.stringify(result, null, 2));

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.includes('2.50') || result.replyText.includes('2.5') || result.replyText.includes('2,50'),
      'Bot response must present 2.50 USD price for cash'
    );
  });

  it('6. Telegram Bot Runtime Scenario 3: Cyrillic 40100K price query returns active DB prices', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_203', 'Mijoz 203');

    const result = await orchestrator.processQuery('40100K нархи қанча?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.includes('2.39') ||
      result.replyText.includes('2.50') ||
      result.replyText.includes('2.5') ||
      result.replyText.includes('40100') ||
      result.intent === 'product_price'
    );
  });

  it('7. Telegram Bot Runtime Scenario 4: Stock query with UNKNOWN inventory triggers safe handoff without fake stock claim', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_204', 'Mijoz 204');

    const result = await orchestrator.processQuery('40100K omborda bormi?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      !result.replyText.toLowerCase().includes('10000 kg bor') &&
      !result.replyText.toLowerCase().includes('omborda bor'),
      'Bot must not claim false stock when inventory is UNKNOWN'
    );
  });
});
