import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { processTelegramUpdate } from '../../apps/api/dist/modules/telegram/service.js';
import { processWhatsAppUpdate } from '../../apps/api/dist/modules/whatsapp/service.js';
import { processWebChatMessage } from '../../apps/api/dist/modules/webchat/service.js';
import {
  importKnowledgePackV2,
  InMemoryCustomerRepository,
  InMemoryContactRepository,
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  InMemoryHandoffRepository,
  InMemoryProductRepository,
  InMemoryKnowledgeRepository,
  InMemoryTelegramBusinessConnectionRepository,
  InMemoryTelegramUpdateReceiptRepository,
} from '../../packages/database/dist/index.js';
import type { Repositories } from '../../packages/shared/dist/index.js';

describe('Stage 7: Channel Handoff Suppression & Importer Schema Integration Tests', () => {
  const createFreshRepos = (): Repositories => ({
    customers: new InMemoryCustomerRepository(),
    contacts: new InMemoryContactRepository(),
    conversations: new InMemoryConversationRepository(),
    messages: new InMemoryMessageRepository(),
    leads: {} as any,
    handoffs: new InMemoryHandoffRepository(),
    products: new InMemoryProductRepository(),
    knowledge: new InMemoryKnowledgeRepository(),
    productPrices: {} as any,
    productInventory: {} as any,
    productCertificates: {} as any,
    productMedia: {} as any,
    salesSettings: {} as any,
    auditLogs: {} as any,
    aiUsage: { create: async () => ({}) } as any,
    telegramConnections: new InMemoryTelegramBusinessConnectionRepository(),
    telegramReceipts: new InMemoryTelegramUpdateReceiptRepository(),
  });

  it('1. Telegram Channel: Complaint triggers handoff, WAITING_MANAGER, suppresses AI outbound message & deduplicates', async () => {
    const repos = createFreshRepos();
    let telegramSenderCalled = false;

    const mockTelegramClient: any = {
      sendMessage: async () => {
        telegramSenderCalled = true;
        return { message_id: 999 };
      },
    };

    const update = {
      update_id: 10001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Customer' },
        text: 'Ip tuklik qilyapti, brak',
      },
    };

    const result = await processTelegramUpdate({
      update,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
    });

    assert.strictEqual(result.status, 'PROCESSED');
    assert.strictEqual(result.reason, 'SUPPRESSED_FOR_HANDOFF');

    // 1. Exactly 1 PENDING handoff created
    const allConvs = await repos.conversations.findAll({});
    assert.strictEqual(allConvs.length, 1);
    const conv = allConvs[0];
    assert.strictEqual(conv.status, 'WAITING_MANAGER');

    const handoffs = await repos.handoffs.findByConversationId(conv.id);
    assert.strictEqual(handoffs.length, 1);
    assert.strictEqual(handoffs[0].status, 'PENDING');
    assert.strictEqual(handoffs[0].priority, 'high');

    // 2. Client sender NOT called for customer reply
    assert.strictEqual(telegramSenderCalled, false);

    // 3. No outbound AI message saved in DB
    const messages = await repos.messages.findByConversationId(conv.id);
    const aiMessages = messages.filter((m) => m.senderType === 'ai');
    assert.strictEqual(aiMessages.length, 0);

    // 4. Second identical update does NOT create duplicate handoff
    const update2 = {
      ...update,
      update_id: 10002,
      message: { ...update.message, message_id: 2, text: 'Menejer qachon aloqaga chiqadi?' },
    };

    const result2 = await processTelegramUpdate({
      update: update2,
      repos,
      client: mockTelegramClient,
      allowRegularMessages: true,
    });

    assert.strictEqual(result2.status, 'PROCESSED');
    const handoffsAfter2 = await repos.handoffs.findByConversationId(conv.id);
    assert.strictEqual(handoffsAfter2.length, 1);
  });

  it('2. WhatsApp Channel: Manager request creates 1 handoff, WAITING_MANAGER, suppresses client & AI outbound message', async () => {
    const repos = createFreshRepos();
    let whatsappSenderCalled = false;

    const mockWhatsAppClient: any = {
      sendTextMessage: async () => {
        whatsappSenderCalled = true;
        return { message_id: 'wa-out-1' };
      },
    };

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '123', phone_number_id: 'ph-1' },
                contacts: [{ profile: { name: 'WA Buyer' }, wa_id: '998901234567' }],
                messages: [
                  {
                    from: '998901234567',
                    id: 'wamid.101',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: 'Menejer bilan gaplashmoqchiman' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const result = await processWhatsAppUpdate({
      payload,
      repos,
      client: mockWhatsAppClient,
    });

    assert.strictEqual(result.status, 'PROCESSED');
    assert.strictEqual(result.reason, 'SUPPRESSED_FOR_HANDOFF');

    const allConvs = await repos.conversations.findAll({});
    assert.strictEqual(allConvs.length, 1);
    const conv = allConvs[0];
    assert.strictEqual(conv.status, 'WAITING_MANAGER');

    const handoffs = await repos.handoffs.findByConversationId(conv.id);
    assert.strictEqual(handoffs.length, 1);
    assert.strictEqual(handoffs[0].status, 'PENDING');

    assert.strictEqual(whatsappSenderCalled, false);

    const messages = await repos.messages.findByConversationId(conv.id);
    const aiMessages = messages.filter((m) => m.senderType === 'ai');
    assert.strictEqual(aiMessages.length, 0);
  });

  it('3. Webchat Channel: HOT lead creates 1 handoff, WAITING_MANAGER, suppresses AI outbound message & returns HANDOFF status', async () => {
    const repos = createFreshRepos();

    const result = await processWebChatMessage({
      sessionId: 'web-session-777',
      senderName: 'Web Client',
      text: '3 tonna oq 30/70 kerak exportga',
      repos,
    });

    assert.strictEqual(result.status, 'HANDOFF');
    assert.strictEqual(result.suppressed, true);
    assert.ok(result.conversationId);

    const conv = await repos.conversations.findById(result.conversationId);
    assert.strictEqual(conv?.status, 'WAITING_MANAGER');

    const handoffs = await repos.handoffs.findByConversationId(result.conversationId);
    assert.strictEqual(handoffs.length, 1);
    assert.strictEqual(handoffs[0].status, 'PENDING');

    const messages = await repos.messages.findByConversationId(result.conversationId);
    const aiMessages = messages.filter((m) => m.senderType === 'ai');
    assert.strictEqual(aiMessages.length, 0);
  });

  it('4. PostgreSQL Knowledge Importer Schema & Transaction Mocked Pool Test', async () => {
    const executedQueries: Array<{ sql: string; values?: any[] }> = [];
    let transactionActive = false;

    const mockClient = {
      query: async (queryText: string | { text: string; values?: any[] }, values?: any[]) => {
        const sql = typeof queryText === 'string' ? queryText : queryText.text;
        const vals = typeof queryText === 'string' ? values : queryText.values;
        executedQueries.push({ sql, values: vals });

        if (sql === 'BEGIN') transactionActive = true;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') transactionActive = false;

        if (sql.includes('SELECT source FROM knowledge_items')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO knowledge_items')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool: any = {
      connect: async () => mockClient,
    };

    const filePath = path.join(process.cwd(), 'data', 'knowledge', 'conversation-pack.v2.json');

    const result = await importKnowledgePackV2(filePath, {
      dryRun: false,
      confirmStaging: true,
      pool: mockPool,
    });

    assert.strictEqual(result.total, 14);
    assert.strictEqual(result.created, 14);
    assert.strictEqual(result.skipped, 0);

    // Verify SQL query assertions
    const selectQuery = executedQueries.find((q) => q.sql.includes('SELECT'));
    assert.ok(selectQuery);
    assert.strictEqual(selectQuery.sql.includes('knowledge_items'), true);
    assert.strictEqual(selectQuery.sql.includes('knowledge_base'), false);

    const insertQueries = executedQueries.filter((q) => q.sql.includes('INSERT'));
    assert.strictEqual(insertQueries.length, 14);
    for (const q of insertQueries) {
      assert.strictEqual(q.sql.includes('knowledge_items'), true);
      assert.strictEqual(q.sql.includes('knowledge_base'), false);
      assert.strictEqual(q.sql.includes('category'), false);
      assert.strictEqual(q.sql.includes('tags'), false);
      assert.ok(q.values);
      assert.strictEqual(q.values.length, 5); // $1-$5 parameterization
    }

    const beginQuery = executedQueries.find((q) => q.sql === 'BEGIN');
    const commitQuery = executedQueries.find((q) => q.sql === 'COMMIT');
    assert.ok(beginQuery);
    assert.ok(commitQuery);
  });

  it('5. PostgreSQL Knowledge Importer Rollback on Error Test', async () => {
    let rollbackExecuted = false;

    const mockFailingClient = {
      query: async (queryText: string | { text: string; values?: any[] }) => {
        const sql = typeof queryText === 'string' ? queryText : queryText.text;
        if (sql === 'ROLLBACK') rollbackExecuted = true;
        if (sql.includes('SELECT source FROM knowledge_items')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO knowledge_items')) {
          throw new Error('Simulated DB Constraint Violation');
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockFailingPool: any = {
      connect: async () => mockFailingClient,
    };

    const filePath = path.join(process.cwd(), 'data', 'knowledge', 'conversation-pack.v2.json');

    await assert.rejects(
      async () => {
        await importKnowledgePackV2(filePath, {
          dryRun: false,
          confirmStaging: true,
          pool: mockFailingPool,
        });
      },
      /KNOWLEDGE IMPORTER TRANSACTION ERROR/
    );

    assert.strictEqual(rollbackExecuted, true);
  });
});
