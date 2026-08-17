import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import {
  getDbPool,
  closeDbPool,
  runMigrations,
  createRepositories,
  type Repositories,
} from '../../packages/database/dist/index.js';
import {
  AIOrchestrator,
  MockEmbeddingProvider,
} from '../../packages/ai-engine/dist/index.js';

const { Pool } = pg;

// Safety Guard: Require ONLY LIMAX_TEST_DATABASE_URL (No DATABASE_URL fallback permitted)
const TEST_DB_URL = process.env.LIMAX_TEST_DATABASE_URL || '';

describe('Stage 15: Real PostgreSQL + pgvector RAG & Business Truth Integration Tests', () => {
  let pool: pg.Pool;
  let testDbName: string;
  let repos: Repositories;
  let testDbUrl: string;
  let orchestrator: AIOrchestrator;

  // Real DB References
  let testCustomerId: string;
  let testContactId: string;
  let conv1Id: string;
  let conv2Id: string;
  let conv3Id: string;
  let conv4Id: string;
  let conv5Id: string;
  let conv6Id: string;

  // Test Entities IDs
  let prodCottonId: string;
  let prodPolyesterId: string;
  let prodCardedId: string;
  let approvedKnowledgeId: string;
  let draftKnowledgeId: string;
  let expiredKnowledgeId: string;

  before(async () => {
    if (!TEST_DB_URL) {
      console.log('\n[Stage 15 PostgreSQL Test] SKIPPED / NOT RUN (LIMAX_TEST_DATABASE_URL is not set)\n');
      return;
    }

    if (!TEST_DB_URL.startsWith('postgres:') && !TEST_DB_URL.startsWith('postgresql:')) {
      throw new Error('LIMAX_TEST_DATABASE_URL must be a valid postgresql connection URL');
    }

    const parsed = new URL(TEST_DB_URL);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error('Integration tests are restricted to local test databases (127.0.0.1 or localhost)');
    }

    const baseDbName = parsed.pathname.slice(1);
    if (!baseDbName.startsWith('limax_test')) {
      throw new Error('LIMAX_TEST_DATABASE_URL database name must start with limax_test or limax_test_');
    }

    testDbName = `limax_test_stage15_${Date.now()}`;
    const adminUrl = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/postgres`;
    const adminPool = new Pool({ connectionString: adminUrl });
    await adminPool.query(`CREATE DATABASE "${testDbName}"`);
    await adminPool.end();

    testDbUrl = `postgresql://${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/${testDbName}`;
    process.env.DATABASE_URL = testDbUrl;

    pool = getDbPool(testDbUrl);
    await runMigrations(pool);
    repos = createRepositories('postgres', pool);
    orchestrator = new AIOrchestrator({ repos, aiMode: 'mock' });

    // Setup base customer, contact, and conversations for relational integrity
    const customer = await repos.customers.create({
      name: 'TEST_STAGE15 Customer',
      channel: 'telegram',
    });
    testCustomerId = customer.id;

    const contact = await repos.contacts.create({
      customerId: testCustomerId,
      channel: 'telegram',
      externalId: '150000001',
    });
    testContactId = contact.id;

    const c1 = await repos.conversations.create({
      customerId: testCustomerId,
      contactId: testContactId,
      channel: 'telegram',
      lastMessageAt: new Date(),
    });
    conv1Id = c1.id;

    const c2 = await repos.conversations.create({
      customerId: testCustomerId,
      contactId: testContactId,
      channel: 'telegram',
      lastMessageAt: new Date(),
    });
    conv2Id = c2.id;

    const c3 = await repos.conversations.create({
      customerId: testCustomerId,
      contactId: testContactId,
      channel: 'telegram',
      lastMessageAt: new Date(),
    });
    conv3Id = c3.id;

    const c4 = await repos.conversations.create({
      customerId: testCustomerId,
      contactId: testContactId,
      channel: 'telegram',
      lastMessageAt: new Date(),
    });
    conv4Id = c4.id;

    const c5 = await repos.conversations.create({
      customerId: testCustomerId,
      contactId: testContactId,
      channel: 'telegram',
      lastMessageAt: new Date(),
    });
    conv5Id = c5.id;

    const c6 = await repos.conversations.create({
      customerId: testCustomerId,
      contactId: testContactId,
      channel: 'telegram',
      lastMessageAt: new Date(),
    });
    conv6Id = c6.id;
  });

  after(async () => {
    if (!TEST_DB_URL || !testDbName) return;

    try {
      await closeDbPool();
    } catch {
      // Ignore
    }

    try {
      const parsed = new URL(TEST_DB_URL);
      const adminUrl = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/postgres`;
      const adminPool = new Pool({ connectionString: adminUrl });
      await adminPool.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()
      `);
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
      await adminPool.end();
    } catch (err) {
      console.warn(`[Stage 15 Teardown] Failed to drop test DB ${testDbName}:`, err);
    }
  });

  it('1. Setup structured business products, prices, and inventory in PostgreSQL', async () => {
    if (!TEST_DB_URL) return;

    // 1. Create Products
    const p1 = await repos.products.create({
      code: 'TEST_STAGE15_YARN_30_70',
      name: 'TEST_STAGE15 Paxta Ip Kalava 30/70',
      category: 'YARN',
      description: 'Yuqori sifatli 30/70 ip kalava (O‘zbekiston paxtasi)',
      price: 9.99, // Legacy fallback column — MUST NOT BE USED
      currency: 'USD',
      active: true,
    });
    prodCottonId = p1.id;

    const p2 = await repos.products.create({
      code: 'TEST_STAGE15_DTY_75_36',
      name: 'TEST_STAGE15 Polyester DTY 75D/36',
      category: 'POLYESTER',
      description: 'Tekstura qilingan sintetik ip',
      price: 8.88, // Legacy fallback column
      currency: 'USD',
      active: true,
    });
    prodPolyesterId = p2.id;

    const p3 = await repos.products.create({
      code: 'TEST_STAGE15_CARD_40_1',
      name: 'TEST_STAGE15 Kard Kalava 40/1',
      category: 'CARDED',
      description: 'Toza paxta kard kalava',
      price: 7.77,
      currency: 'USD',
      active: true,
    });
    prodCardedId = p3.id;

    // 2. Create Prices in product_prices table
    // Product 1: Valid active price
    await repos.productPrices.create({
      productId: prodCottonId,
      price: 2.85,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 500,
      validFrom: new Date('2025-01-01'),
      active: true,
    });

    // Product 3: Expired price
    await repos.productPrices.create({
      productId: prodCardedId,
      price: 3.10,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 200,
      validFrom: new Date('2024-01-01'),
      validUntil: new Date('2024-12-31'),
      active: true,
    });

    // Product 2: NO active price row in product_prices

    // 3. Create Inventory in product_inventory table
    // Product 1: Positive Stock (1200 avail - 200 reserved = 1000 net)
    await repos.productInventory.upsert(prodCottonId, {
      availableQuantity: 1200,
      reservedQuantity: 200,
      status: 'IN_STOCK',
      warehouse: 'Toshkent Bosh Ombor',
    });

    // Product 2: Net Zero Stock (50 avail - 50 reserved = 0 net -> OUT_OF_STOCK)
    await repos.productInventory.upsert(prodPolyesterId, {
      availableQuantity: 50,
      reservedQuantity: 50,
      status: 'OUT_OF_STOCK',
      warehouse: 'Toshkent 2-Ombor',
    });

    // Product 3: No inventory row (UNKNOWN)

    assert.ok(prodCottonId);
    assert.ok(prodPolyesterId);
    assert.ok(prodCardedId);
  });

  it('2. Setup APPROVED and DRAFT Knowledge Base items with real 1536 pgvector embeddings', async () => {
    if (!TEST_DB_URL) return;

    // 1. Create APPROVED Knowledge Item
    const k1 = await repos.knowledge.create({
      title: 'TEST_STAGE15 Yetkazib berish shartlari',
      content: 'LImax mahsulotlarini O‘zbekiston bo‘yicha 3 ish kunida, MDH davlatlariga 7-10 kunda yetkazib beradi.',
      language: 'uz',
      status: 'APPROVED',
      source: 'DOC_DELIVERY_2026',
    });
    approvedKnowledgeId = k1.id;

    // 2. Create DRAFT Knowledge Item (MUST BE EXCLUDED)
    const k2 = await repos.knowledge.create({
      title: 'TEST_STAGE15 Maxfiy Chegirma Siyosati (DRAFT)',
      content: 'Barcha yangi mijozlarga 50% chegirma beriladi.',
      language: 'uz',
      status: 'DRAFT',
      source: 'SECRET_DRAFT_2026',
    });
    draftKnowledgeId = k2.id;

    // 3. Create EXPIRED Knowledge Item (MUST BE EXCLUDED)
    const k3 = await repos.knowledge.create({
      title: 'TEST_STAGE15 Eski Aksiya 2023',
      content: '2023 yil dekabrgacha bepul yetkazib berish.',
      language: 'uz',
      status: 'APPROVED',
      validUntil: new Date('2023-12-31'),
    });
    expiredKnowledgeId = k3.id;

    // 4. Insert real 1536 dimension pgvector embeddings via mockEmbeddingProvider
    const mockEmb = new MockEmbeddingProvider();
    const [chunkEmbApproved] = await mockEmb.embed(['TEST_STAGE15 Yetkazib berish shartlari']);
    const [chunkEmbDraft] = await mockEmb.embed(['Barcha yangi mijozlarga 50% chegirma beriladi.']);

    await repos.knowledge.replaceChunks(approvedKnowledgeId, [
      {
        chunkIndex: 0,
        content: 'LImax mahsulotlarini O‘zbekiston bo‘yicha 3 ish kunida yetkazib beradi.',
        embedding: chunkEmbApproved,
        metadata: { source: 'DOC_DELIVERY_2026' },
      },
    ]);

    await repos.knowledge.replaceChunks(draftKnowledgeId, [
      {
        chunkIndex: 0,
        content: 'Barcha yangi mijozlarga 50% chegirma beriladi.',
        embedding: chunkEmbDraft,
        metadata: { source: 'SECRET_DRAFT_2026' },
      },
    ]);

    assert.ok(approvedKnowledgeId);
    assert.ok(draftKnowledgeId);
    assert.ok(expiredKnowledgeId);
  });

  it('3. Real pgvector cosine similarity retrieval filters DRAFT and retrieves only APPROVED items', async () => {
    if (!TEST_DB_URL) return;

    const mockEmb = new MockEmbeddingProvider();
    const [queryEmbedding] = await mockEmb.embed(['TEST_STAGE15 Yetkazib berish shartlari']);
    const queryVectorStr = `[${queryEmbedding.join(',')}]`;

    const result = await pool.query(
      `SELECT kc.id, kc.content, ki.title, ki.status, ki.source, (1 - (kc.embedding <=> $1::vector)) as similarity
       FROM knowledge_chunks kc
       JOIN knowledge_items ki ON kc.knowledge_item_id = ki.id
       WHERE ki.status = 'APPROVED'
       ORDER BY kc.embedding <=> $1::vector
       LIMIT 5`,
      [queryVectorStr]
    );

    assert.ok(result.rows.length >= 1);
    const retrieved = result.rows[0];
    assert.equal(retrieved.status, 'APPROVED');
    assert.ok(retrieved.title.includes('Yetkazib berish shartlari'));
    assert.ok(!result.rows.some((r) => r.status === 'DRAFT'));
    assert.ok(parseFloat(retrieved.similarity) > 0.95);
  });

  it('4. Runtime Price Query with Real PostgreSQL: selects active price 2.85 USD, ignores legacy 9.99', async () => {
    if (!TEST_DB_URL) return;

    const result = await orchestrator.processQuery('TEST_STAGE15 Paxta Ip Kalava 30/70 narxi qancha?', {
      preferredLanguage: 'uz',
      conversationId: conv1Id,
    });

    assert.equal(result.intent, 'product_price');
    assert.ok(result.replyText.includes('2.85 USD'));
    assert.ok(result.replyText.includes('500 kg'));
    assert.ok(!result.replyText.includes('9.99')); // Legacy products.price rejected
    assert.equal(result.needsHandoff, false);
  });

  it('5. Runtime Price Query with No Active Price in DB: triggers safe unconfirmed price handoff', async () => {
    if (!TEST_DB_URL) return;

    const result = await orchestrator.processQuery('TEST_STAGE15 Polyester DTY 75D/36 narxi qancha?', {
      preferredLanguage: 'uz',
      conversationId: conv2Id,
    });

    assert.equal(result.intent, 'product_price');
    assert.ok(!result.replyText.includes('8.88')); // Legacy price rejected
    assert.ok(result.replyText.includes('amaldagi narx bazada tasdiqlanmagan'));
    assert.equal(result.needsHandoff, true);
    assert.ok(result.handoffReason === 'MISSING_ACTIVE_PRICE' || result.handoffReason === 'PRICE_UNCONFIRMED_IN_DB');
  });

  it('6. Runtime Stock Query with Real PostgreSQL: positive net stock returns available quantity', async () => {
    if (!TEST_DB_URL) return;

    const result = await orchestrator.processQuery('TEST_STAGE15 Paxta Ip Kalava 30/70 omborda bormi?', {
      preferredLanguage: 'uz',
      conversationId: conv3Id,
    });

    assert.equal(result.intent, 'product_stock');
    assert.ok(result.replyText.includes('omborda mavjud') || result.replyText.includes('mavjud'));
    assert.equal(result.needsHandoff, false);
  });

  it('7. Runtime Stock Query with Net-Zero in DB: returns OUT_OF_STOCK handoff', async () => {
    if (!TEST_DB_URL) return;

    const result = await orchestrator.processQuery('TEST_STAGE15 Polyester DTY 75D/36 omborda bormi?', {
      preferredLanguage: 'uz',
      conversationId: conv4Id,
    });

    assert.equal(result.intent, 'product_stock');
    assert.ok(result.replyText.includes('mavjud emas') || result.replyText.includes('нет в наличии'));
    assert.equal(result.needsHandoff, true);
    assert.ok(result.handoffReason === 'INVENTORY_STATUS_OUT_OF_STOCK' || result.handoffReason === 'PRODUCT_OUT_OF_STOCK');
  });

  it('8. Runtime Stock Query with Missing Inventory Row: returns UNKNOWN handoff', async () => {
    if (!TEST_DB_URL) return;

    const result = await orchestrator.processQuery('TEST_STAGE15 Kard Kalava 40/1 omborda bormi?', {
      preferredLanguage: 'uz',
      conversationId: conv5Id,
    });

    assert.equal(result.intent, 'product_stock');
    assert.equal(result.needsHandoff, true);
    assert.ok(result.handoffReason === 'INVENTORY_STATUS_UNKNOWN' || result.handoffReason === 'STOCK_STATUS_UNKNOWN');
  });

  it('9. Domain Knowledge Inquiry: retrieves APPROVED item from PostgreSQL and ignores DRAFT', async () => {
    if (!TEST_DB_URL) return;

    const result = await orchestrator.processQuery('TEST_STAGE15 Yetkazib berish shartlari qanday?', {
      preferredLanguage: 'uz',
      conversationId: conv6Id,
    });

    assert.ok(result.usedKnowledgeIds.includes(approvedKnowledgeId));
    assert.ok(!result.usedKnowledgeIds.includes(draftKnowledgeId));
    assert.ok(!result.usedKnowledgeIds.includes(expiredKnowledgeId));
  });

  it('10. UTF-8 Round-Trip and Special Characters in PostgreSQL Business Data', async () => {
    if (!TEST_DB_URL) return;

    const testText = 'Ўзбекистон бўйicha етказиб бериш — 100% кафолатланған (30/70, 75D/36, №1-қисм)';
    const kUtf8 = await repos.knowledge.create({
      title: 'TEST_STAGE15 UTF8 Маълумот',
      content: testText,
      language: 'uz-Cyrl',
      status: 'APPROVED',
    });

    const fetched = await repos.knowledge.findById(kUtf8.id);
    assert.ok(fetched);
    assert.equal(fetched.content, testText);
  });
});
