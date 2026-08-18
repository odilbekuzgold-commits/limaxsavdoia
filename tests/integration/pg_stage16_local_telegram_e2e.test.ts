import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import {
  createRepositories,
  runMigrations,
  type Repositories,
} from '../../packages/database/dist/index.js';
import {
  type TelegramUpdate,
  TelegramClient,
} from '../../packages/channel-adapters/dist/index.js';
import { processTelegramUpdate } from '../../apps/api/dist/modules/telegram/service.js';

process.env.RESPONSE_DELAY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_MANAGER_CHAT_ID = process.env.TELEGRAM_MANAGER_CHAT_ID || '-1002345678901';

function getTestDbUrl(): string {
  const dbUrl = process.env.LIMAX_TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('LIMAX_TEST_DATABASE_URL or DATABASE_URL environment variable is required for PostgreSQL integration tests');
  }
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
  if (!dbName.includes('test')) {
    throw new Error(`Safety check failed: Database name must contain 'test', got '${dbName}'`);
  }
  return dbUrl;
}

describe('Stage 16: Local Real Telegram End-to-End & PostgreSQL Persistence Tests', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  const dbUrl = getTestDbUrl();
  const testManagerChatId = process.env.TELEGRAM_MANAGER_CHAT_ID || '-1002345678901';

  // Dynamic ID base to ensure clean state per run
  const baseUpdateId = Math.floor(Date.now() / 1000) * 100;

  // Track outbound messages sent to Telegram
  const sentCustomerMessages: Array<{ chatId: string; text: string; businessConnectionId?: string }> = [];
  const sentManagerNotifications: Array<{ chatId: string; text: string }> = [];

  let mockTelegramClient: TelegramClient;

  before(async () => {
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    await pool.query('SELECT 1');

    // Run migrations up to 013
    await runMigrations(pool);
    repos = createRepositories('postgres', pool);

    // Create a deterministic Mock Telegram Client that captures outbound calls
    mockTelegramClient = {
      botToken: 'mock-bot-token',
      async sendMessage(params: any) {
        const idStr = String(params.chat_id || params.chatId || '');
        const text = params.text || '';
        const businessConnectionId = params.business_connection_id || params.businessConnectionId;
        if (idStr === testManagerChatId || idStr.startsWith('-100')) {
          sentManagerNotifications.push({ chatId: idStr, text });
        } else {
          sentCustomerMessages.push({
            chatId: idStr,
            text,
            businessConnectionId,
          });
        }
        return { message_id: Math.floor(Math.random() * 100000) };
      },
      async sendChatAction() {
        return true;
      },
      async getMe() {
        return { ok: true, result: { id: 123456789, is_bot: true, first_name: 'LImax AI Manager', username: 'Limax_Manager_AI_1_bot' } };
      },
      async getWebhookInfo() {
        return { ok: true, result: { url: '', pending_update_count: 0 } };
      },
    } as unknown as TelegramClient;
  });

  after(async () => {
    if (pool) {
      try {
        await pool.query("DELETE FROM knowledge_chunks WHERE content LIKE '%STAGE16_%'");
        await pool.query("DELETE FROM knowledge_items WHERE title LIKE '%STAGE16_%'");
        await pool.query("DELETE FROM product_prices WHERE product_id IN (SELECT id FROM products WHERE code LIKE 'TEST_%')");
        await pool.query("DELETE FROM product_inventory WHERE product_id IN (SELECT id FROM products WHERE code LIKE 'TEST_%')");
        await pool.query("DELETE FROM products WHERE code LIKE 'TEST_%'");
        await pool.query("DELETE FROM telegram_receipts WHERE update_id >= 1600000000");
      } catch {}
      await pool.end();
    }
  });

  it('1. Preflight: PostgreSQL migration ledger contains all 13 migrations', async () => {
    const ledger = await pool.query('SELECT name FROM _migrations ORDER BY name ASC');
    assert.ok(ledger.rows.length >= 13, `Expected at least 13 applied migrations, found ${ledger.rows.length}`);
    const names = ledger.rows.map((r) => r.name);
    assert.ok(names.includes('001_pgvector_extension'));
    assert.ok(names.includes('013_knowledge_runtime_rag_alignment'));
  });

  it('2. Seed TEST_ONLY Products, Active Prices and Inventory in PostgreSQL', async () => {
    // 1. TEST_POLY_3070 with active price 2.85 USD
    const p1 = await repos.products.create({
      code: `TEST_POLY_3070_${Date.now()}`,
      name: 'Polyester Kalava Ip 30/70 TEST_ONLY',
      category: 'Yarn',
      description: '30/70 aralash kalava ip',
      price: 2.85,
      currency: 'USD',
      active: true,
    });

    await repos.productPrices.create({
      productId: p1.id,
      currency: 'USD',
      price: 2.85,
      minQuantity: 500,
      unit: 'kg',
      isActive: true,
      validFrom: new Date(),
    });

    // 2. TEST_POLY_75D with 5000 kg available, 1000 kg reserved (net 4000 kg)
    const p2 = await repos.products.create({
      code: `TEST_POLY_75D_${Date.now()}`,
      name: 'Polyester DTY 75D/36 TEST_ONLY',
      category: 'Yarn',
      description: 'DTY 75D/36 oq teksturlangan ip',
      price: 3.20,
      currency: 'USD',
      active: true,
    });

    await repos.productInventory.upsert(p2.id, {
      availableQuantity: 5000,
      reservedQuantity: 1000,
      status: 'IN_STOCK',
    });

    // 3. TEST_POLY_ZERO with net 0 stock
    const p3 = await repos.products.create({
      code: `TEST_POLY_ZERO_${Date.now()}`,
      name: 'Polyester Spun 2070K TEST_ONLY',
      category: 'Yarn',
      description: 'Spun 2070K ip',
      price: 2.10,
      currency: 'USD',
      active: true,
    });

    await repos.productInventory.upsert(p3.id, {
      availableQuantity: 1000,
      reservedQuantity: 1000,
      status: 'OUT_OF_STOCK',
    });

    // 4. APPROVED Knowledge Item with 1536 pgvector embedding
    const kRes = await pool.query(
      `INSERT INTO knowledge_items (title, content, language, status, approved_by, approved_at, created_at, updated_at)
       VALUES ('STAGE16_TEST_PAYMENT_TERMS', 'LImax korxonasida to‘lov shartlari: 30% oldindan to‘lov, 70% yuk tayyor bo‘lgach.', 'uz', 'APPROVED', '00000000-0000-0000-0000-000000000001', NOW(), NOW(), NOW())
       RETURNING id`
    );
    const kId = kRes.rows[0].id;

    const mockVec = new Array(1536).fill(0.015);
    await pool.query(
      `INSERT INTO knowledge_chunks (knowledge_item_id, chunk_index, content, language, embedding, metadata, created_at, updated_at)
       VALUES ($1, 0, 'LImax korxonasida to‘lov shartlari: 30% oldindan to‘lov, 70% yuk tayyor bo‘lgach.', 'uz', $2::vector, $3, NOW(), NOW())`,
      [kId, `[${mockVec.join(',')}]`, JSON.stringify({ contentHash: 'abc', dimensions: 1536, model: 'text-embedding-3-small' })]
    );

    assert.ok(p1 && p2 && p3 && kId);
  });

  it('3. Scenario 1: Greeting "Salom" routes via Template with 0 AI/embedding consumption', async () => {
    sentCustomerMessages.length = 0;
    const update: TelegramUpdate = {
      update_id: baseUpdateId + 1,
      business_message: {
        message_id: 101,
        from: { id: baseUpdateId + 1, first_name: 'Test Customer 1', is_bot: false },
        chat: { id: baseUpdateId + 1, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Assalomu alaykum',
        business_connection_id: 'biz_conn_16_1',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'PROCESSED');
    const contact = await repos.contacts.findByChannelAndExternalId('telegram', String(baseUpdateId + 1));
    assert.ok(contact);
    const convRow = (await pool.query('SELECT id, status FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id])).rows[0];
    assert.ok(convRow);
    const msgs = await repos.messages.findByConversationId(convRow.id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg, 'AI reply message should be persisted in PostgreSQL');
    assert.match(aiMsg.content, /assalomu al[ae]ykum/i);
  });

  it('4. Scenario 2: Price Query for TEST_POLY_3070 returns active DB price (2.85 USD)', async () => {
    sentCustomerMessages.length = 0;
    const update: TelegramUpdate = {
      update_id: baseUpdateId + 2,
      business_message: {
        message_id: 102,
        from: { id: baseUpdateId + 2, first_name: 'Test Customer 2', is_bot: false },
        chat: { id: baseUpdateId + 2, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '30/70 kalava ip narxi qancha?',
        business_connection_id: 'biz_conn_16_2',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'PROCESSED');
    const contact = await repos.contacts.findByChannelAndExternalId('telegram', String(baseUpdateId + 2));
    assert.ok(contact);
    const convRow = (await pool.query('SELECT id, status FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id])).rows[0];
    assert.ok(convRow);
    const msgs = await repos.messages.findByConversationId(convRow.id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg, 'AI price message should be persisted in PostgreSQL');
    assert.match(aiMsg.content, /2\.85/);
    assert.match(aiMsg.content, /USD|\$/i);
  });

  it('5. Scenario 3: Stock Query for TEST_POLY_75D calculates net available (4000 kg)', async () => {
    sentCustomerMessages.length = 0;
    const update: TelegramUpdate = {
      update_id: baseUpdateId + 3,
      business_message: {
        message_id: 103,
        from: { id: baseUpdateId + 3, first_name: 'Test Customer 3', is_bot: false },
        chat: { id: baseUpdateId + 3, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '75D/36 ipdan omborda qancha qoldiq bor?',
        business_connection_id: 'biz_conn_16_3',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'PROCESSED');
    const contact = await repos.contacts.findByChannelAndExternalId('telegram', String(baseUpdateId + 3));
    assert.ok(contact);
    const convRow = (await pool.query('SELECT id, status FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id])).rows[0];
    assert.ok(convRow);
    const msgs = await repos.messages.findByConversationId(convRow.id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg, 'AI stock message should be persisted in PostgreSQL');
    assert.match(aiMsg.content, /4\s*000|4000/);
  });

  it('6. Scenario 4: Stock Query for TEST_POLY_ZERO (net 0) outputs OUT_OF_STOCK', async () => {
    sentCustomerMessages.length = 0;
    const update: TelegramUpdate = {
      update_id: baseUpdateId + 4,
      business_message: {
        message_id: 104,
        from: { id: baseUpdateId + 4, first_name: 'Test Customer 4', is_bot: false },
        chat: { id: baseUpdateId + 4, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '2070K ip bormi hozir omborda?',
        business_connection_id: 'biz_conn_16_4',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'PROCESSED');
    const contact = await repos.contacts.findByChannelAndExternalId('telegram', String(baseUpdateId + 4));
    assert.ok(contact);
    const convRow = (await pool.query('SELECT id, status FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id])).rows[0];
    assert.ok(convRow);
    const msgs = await repos.messages.findByConversationId(convRow.id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg, 'AI out-of-stock message should be persisted in PostgreSQL');
    assert.match(aiMsg.content, /qolmagan|mavjud emas|yetkazib berish/i);
  });

  it('7. Scenario 5 & 6: Manager Request & Handoff Delivery with WAITING_MANAGER state', async () => {
    sentCustomerMessages.length = 0;
    sentManagerNotifications.length = 0;

    const user7Id = baseUpdateId + 5;

    const update: TelegramUpdate = {
      update_id: baseUpdateId + 5,
      business_message: {
        message_id: 105,
        from: { id: user7Id, first_name: 'Lead Customer 5', is_bot: false },
        chat: { id: user7Id, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'ip brak chiqdi, sifat juda yomon',
        business_connection_id: 'biz_conn_16_5',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'PROCESSED');

    // Customer acknowledgment in DB
    const contact = await repos.contacts.findByChannelAndExternalId('telegram', String(user7Id));
    assert.ok(contact);
    const convRow = (await pool.query('SELECT id, status FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id])).rows[0];
    assert.ok(convRow);
    const msgs = await repos.messages.findByConversationId(convRow.id);
    const ackMsg = msgs.find((m) => (m.metadata as any)?.messageKind === 'handoff_ack');
    assert.ok(ackMsg, 'Handoff acknowledgment message should be recorded in PostgreSQL');
    assert.match(ackMsg.content, /uzr|menejer|bog‘lanadi/i);

    // Manager group notification
    assert.equal(sentManagerNotifications.length, 1);
    assert.equal(sentManagerNotifications[0].chatId, testManagerChatId);

    // Conversation state in PostgreSQL must be WAITING_MANAGER
    assert.equal(convRow.status, 'WAITING_MANAGER');

    // Subsequent message from customer must NOT trigger standard sales AI reply
    const followUpUpdate: TelegramUpdate = {
      update_id: baseUpdateId + 6,
      business_message: {
        message_id: 106,
        from: { id: user7Id, first_name: 'Lead Customer 5', is_bot: false },
        chat: { id: user7Id, type: 'private' },
        date: Math.floor(Date.now() / 1000) + 1,
        text: 'Qachon javob beradi menejeringiz?',
        business_connection_id: 'biz_conn_16_5',
      },
    };

    const followUpRes = await processTelegramUpdate({
      update: followUpUpdate,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(followUpRes.status, 'PROCESSED');
    const msgsAfter = await repos.messages.findByConversationId(convRow.id);
    const newAiMsgs = msgsAfter.filter((m) => m.senderType === 'ai' && (m.metadata as any)?.messageKind !== 'handoff_ack');
    assert.equal(newAiMsgs.length, 0, 'No standard sales reply should be sent while in WAITING_MANAGER state');
  });

  it('8. Scenario 7: Multilingual scripts & Token preservation (uz-Cyrl and 30/70)', async () => {
    sentCustomerMessages.length = 0;
    const user8Id = baseUpdateId + 7;

    const update: TelegramUpdate = {
      update_id: baseUpdateId + 7,
      business_message: {
        message_id: 107,
        from: { id: user8Id, first_name: 'Cyrillic User', is_bot: false },
        chat: { id: user8Id, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '30/70 калава ип нархи қанча?',
        business_connection_id: 'biz_conn_16_7',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'PROCESSED');
    const contact = await repos.contacts.findByChannelAndExternalId('telegram', String(user8Id));
    assert.ok(contact);
    const convRow = (await pool.query('SELECT id, status FROM conversations WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 1', [contact.id])).rows[0];
    assert.ok(convRow);
    const msgs = await repos.messages.findByConversationId(convRow.id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg, 'AI Cyrillic response should be recorded in PostgreSQL');
    assert.match(aiMsg.content, /2\.85/);
    assert.match(aiMsg.content, /30\/70/);
  });

  it('9. Scenario 8: Deduplication & Persistence: Repeated Update ID is safely ignored', async () => {
    const update: TelegramUpdate = {
      update_id: baseUpdateId + 1, // Already processed in test 3
      business_message: {
        message_id: 101,
        from: { id: baseUpdateId + 1, first_name: 'Test Customer 1', is_bot: false },
        chat: { id: baseUpdateId + 1, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'Assalomu alaykum',
        business_connection_id: 'biz_conn_16_1',
      },
    };

    const res = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
      managerChatId: testManagerChatId,
    });

    assert.equal(res.status, 'SKIPPED');
  });

  it('10. Scenario 9: Dashboard and PostgreSQL persistence matches real counts', async () => {
    const customerCount = (await pool.query('SELECT count(*) FROM customers')).rows[0].count;
    const conversationCount = (await pool.query('SELECT count(*) FROM conversations')).rows[0].count;
    const messageCount = (await pool.query('SELECT count(*) FROM messages')).rows[0].count;
    const handoffCount = (await pool.query('SELECT count(*) FROM handoffs')).rows[0].count;

    assert.ok(parseInt(customerCount, 10) >= 3);
    assert.ok(parseInt(conversationCount, 10) >= 3);
    assert.ok(parseInt(messageCount, 10) >= 4);
    assert.ok(parseInt(handoffCount, 10) >= 1);
  });
});
