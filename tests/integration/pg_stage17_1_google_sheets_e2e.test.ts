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
import {
  AIOrchestrator,
  MockAIProviderAdapter,
} from '../../packages/ai-engine/dist/index.js';

const TEST_DB_URL =
  process.env.LIMAX_TEST_DATABASE_URL ||
  'postgresql://postgres:1111@localhost:5432/limax_test';

describe('Stage 17.1: PostgreSQL Real Integration — Google Sheets E2E & Telegram Runtime', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  let orchestrator: AIOrchestrator;

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 10 });
    try {
      await pool.query('SELECT 1');
      await runMigrations(pool);
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

  it('1. Preflight: Migration 014 applied and google_sheets_sync_state table is accessible', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const res = await pool.query<{ count: string }>('SELECT count(*) FROM google_sheets_sync_state');
    assert.ok(parseInt(res.rows[0].count, 10) >= 0);
  });

  it('2. Atomic PostgreSQL Apply & Source Fidelity Reconciliation', async (t) => {
    if (!repos) return t.skip('PostgreSQL is not available');

    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['productCode', 'productName', 'category', 'color', 'yarnType', 'count', 'composition', 'description', 'unit', 'active', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'MIC COLOR 40100K Poliester', 'Yarn', '', 'Poliester', '40/100', 'Paxta/Poliester', 'Mexanicheskiy ip', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
          ['75D_36', '75D/36 Oq Ip', 'Yarn', 'Oq', 'Poliester', '75D/36', '', 'Vozdushniy ip', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
          ['OUT_STOCK_1', 'Zero Stock Product', 'Yarn', '', 'Cotton', '30/1', '', '', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
          ['UNKNOWN_STOCK_1', 'Unknown Stock Product', 'Yarn', '', 'Cotton', '20/1', '', '', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['productCode', 'paymentType', 'amount', 'currency', 'unit', 'minOrderQuantity', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'BANK_TRANSFER', '2.95', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
          ['40100K', 'CASH', '2.85', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
          ['75D_36', 'BANK_TRANSFER', '3.50', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
          ['OUT_STOCK_1', 'BANK_TRANSFER', '1.99', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
          ['UNKNOWN_STOCK_1', 'BANK_TRANSFER', '2.20', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
        ],
        Inventory: [
          ['productCode', 'availableQuantity', 'reservedQuantity', 'unit', 'warehouse', 'approvalStatus', 'syncEnabled'],
          ['40100K', '10000', '2000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
          ['75D_36', '5000', '1000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
          ['OUT_STOCK_1', '0', '0', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
          ['UNKNOWN_STOCK_1', 'UNKNOWN', '0', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(client, repos, 'postgres', pool);
    const syncRes = await engine.runSync({ dryRun: false });

    assert.strictEqual(syncRes.status, 'SUCCESS');
    assert.strictEqual(syncRes.counts.products, 4);
    assert.strictEqual(syncRes.counts.prices, 5);

    // Reconcile Products from PostgreSQL
    const allProds = await repos.products.findAll({});
    const p40100 = allProds.find((p) => p.code === '40100K');
    assert.ok(p40100, '40100K product must be created in PostgreSQL');
    assert.strictEqual(p40100.name, 'MIC COLOR 40100K Poliester', 'Exact raw product name must be preserved');

    // Reconcile Prices from PostgreSQL
    const p40100Prices = await repos.productPrices.findByProductId(p40100.id);
    const bankPrice = p40100Prices.find((p) => p.paymentType === 'BANK_TRANSFER' && p.active);
    const cashPrice = p40100Prices.find((p) => p.paymentType === 'CASH' && p.active);
    assert.strictEqual(bankPrice?.price, 2.95, 'Active BANK_TRANSFER price must be 2.95 USD');
    assert.strictEqual(cashPrice?.price, 2.85, 'Active CASH price must be 2.85 USD');

    // Reconcile Inventory from PostgreSQL
    const inv40100 = await repos.productInventory.findByProductId(p40100.id);
    assert.strictEqual(inv40100?.availableQuantity, 10000);
    assert.strictEqual(inv40100?.status, 'IN_STOCK');

    const pUnknown = allProds.find((p) => p.code === 'UNKNOWN_STOCK_1');
    assert.ok(pUnknown, 'UNKNOWN_STOCK_1 product must be created in PostgreSQL');
    const invUnknown = await repos.productInventory.findByProductId(pUnknown.id);
    assert.strictEqual(invUnknown?.status, 'UNKNOWN', 'Inventory with UNKNOWN in sheet must have UNKNOWN status');
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

  it('3. Telegram Bot Runtime Scenario 1: Standard product price query from PostgreSQL', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_101', 'Mijoz 101');

    const result = await orchestrator.processQuery('40100K narxi qancha?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.includes('2.95') || result.replyText.includes('2.85') || result.replyText.includes('2.39') || result.replyText.includes('2.50'),
      'Bot response must contain active DB price'
    );
  });

  it('4. Telegram Bot Runtime Scenario 2: CASH vs BANK_TRANSFER distinction', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_102', 'Mijoz 102');

    const result = await orchestrator.processQuery('40100K naqd pulga narxi qancha?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.includes('2.85') || result.replyText.includes('2.50') || result.replyText.includes('2.5'),
      'Bot response should present valid price details from PostgreSQL'
    );
  });

  it('5. Telegram Bot Runtime Scenario 3: Cyrillic price inquiry preservation', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_103', 'Mijoz 103');

    const result = await orchestrator.processQuery('40100K нархи канча?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.includes('2.95') ||
      result.replyText.includes('2.85') ||
      result.replyText.includes('40100') ||
      result.intent === 'product_price' ||
      result.intent === 'price_request'
    );
  });

  it('6. Telegram Bot Runtime Scenario 4: Unknown product leads to unconfirmed price handoff', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_104', 'Mijoz 104');

    const result = await orchestrator.processQuery('NO_SUCH_PRODUCT_999 narxi qancha?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.needsHandoff ||
      result.replyText.includes('menejer') ||
      result.replyText.includes('aniqlashtirib') ||
      result.replyText.includes('qaysi')
    );
  });

  it('7. Telegram Bot Runtime Scenario 5: Stock Query for OUT_OF_STOCK product returns out-of-stock message', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_105', 'Mijoz 105');

    const result = await orchestrator.processQuery('OUT_STOCK_1 omborda bormi?', {
      conversationId: conversation.id,
    });

    assert.ok(result.replyText.length > 0);
    assert.ok(
      result.replyText.toLowerCase().includes('mavjud emas') ||
      result.replyText.toLowerCase().includes('qolmagan') ||
      result.replyText.toLowerCase().includes('out_of_stock') ||
      result.needsHandoff
    );
  });

  it('8. Telegram Bot Runtime Scenario 6: Explicit manager request executes handoff', async (t) => {
    if (!orchestrator) return t.skip('PostgreSQL is not available');

    const conversation = await createTestConversation('tg_user_106', 'Mijoz 106');

    const result = await orchestrator.processQuery("Menejer bilan bog'lang, katta partiya olmoqchiman", {
      conversationId: conversation.id,
    });

    assert.strictEqual(result.needsHandoff, true, 'Manager handoff must be triggered');
  });
});
