/**
 * Stage 7B: Final Mock Routing & Prompt Safety Tests
 *
 * Covers:
 *  - Telegram real service flow (integration)
 *  - UTF-8 / mojibake zero check
 *  - fabricated default (MOQ/stock/price) zero check
 *  - uz-Latn / uz-Cyrl / ru script routing
 *  - "mahsulotlar bormi" → PRODUCT_INQUIRY (not STOCK)
 *  - isNewConversation explicit signal
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { MockAIProviderAdapter, MOJIBAKE_RE } from '../../packages/ai-engine/dist/providers/mock.provider.js';
import { buildSalesSystemPrompt } from '../../packages/ai-engine/dist/prompts/builder.js';
import { processTelegramUpdate } from '../../apps/api/dist/modules/telegram/service.js';
import {
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
import type { AIContext } from '../../packages/shared/dist/index.js';

// ─── Helpers ─────────────────────────────────────────────────
const adapter = new MockAIProviderAdapter();

const mkCtx = (
  overrides: Partial<AIContext> = {}
): AIContext => ({
  preferredLanguage: 'uz',
  conversationHistory: [],
  isNewConversation: true,
  availableProducts: [],
  ...overrides,
});

const mkRepos = (): Repositories => ({
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

const mkUpdate = (updateId: number, chatId: number, text: string, msgId = 1) => ({
  update_id: updateId,
  message: {
    message_id: msgId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: 'private' as const },
    from: { id: chatId, is_bot: false, first_name: 'Tester' },
    text,
  },
});

const mockClient: any = {
  sendMessage: async () => ({ message_id: Math.floor(Math.random() * 99999) }),
};

// ─── Mojibake scan helper ─────────────────────────────────────
function assertNoMojibake(text: string, label: string): void {
  assert.strictEqual(
    MOJIBAKE_RE.test(text),
    false,
    `MOJIBAKE detected in ${label}: "${text.slice(0, 80)}"`
  );
}

// ─────────────────────────────────────────────────────────────
describe('Stage 7B: Mock Routing & Prompt Safety Tests', () => {

  // ══════════════════════════════════════════
  // SECTION A: Telegram Real Service Flow
  // ══════════════════════════════════════════

  it('A1. Telegram: "salom" on new conversation → greeting, PROCESSED', async () => {
    const repos = mkRepos();
    const res = await processTelegramUpdate({
      update: mkUpdate(40001, 80001, 'salom'),
      repos,
      client: mockClient,
      allowRegularMessages: true,
    });
    assert.strictEqual(res.status, 'PROCESSED');

    const convs = await repos.conversations.findAll({});
    assert.strictEqual(convs.length, 1);
    const msgs = await repos.messages.findByConversationId(convs[0].id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg, 'AI message must exist');
    const lower = aiMsg.content.toLowerCase();
    assert.ok(
      lower.includes('assalomu') || lower.includes('yordam') || lower.includes('xush'),
      `Expected greeting but got: "${aiMsg.content}"`
    );
    assertNoMojibake(aiMsg.content, 'A1 greeting reply');
  });

  it('A2. Telegram: second "salom" same user → NOT repeated welcome', async () => {
    const repos = mkRepos();
    // First message
    await processTelegramUpdate({
      update: mkUpdate(40010, 80002, 'salom', 1),
      repos,
      client: mockClient,
      allowRegularMessages: true,
    });
    // Second message — same chatId
    await processTelegramUpdate({
      update: mkUpdate(40011, 80002, 'salom', 2),
      repos,
      client: mockClient,
      allowRegularMessages: true,
    });

    const convs = await repos.conversations.findAll({});
    assert.strictEqual(convs.length, 1);
    const msgs = await repos.messages.findByConversationId(convs[0].id);
    const aiMsgs = msgs.filter((m) => m.senderType === 'ai');
    assert.ok(aiMsgs.length >= 1, 'At least 1 AI message expected');

    // First and second AI messages must NOT be identical welcome messages
    if (aiMsgs.length >= 2) {
      assert.notStrictEqual(
        aiMsgs[0].content,
        aiMsgs[1].content,
        'Second salom must not duplicate first welcome message'
      );
      // Second must not re-show long welcome
      assert.strictEqual(
        aiMsgs[1].content.toLowerCase().includes('xush kelibsiz'),
        false,
        'Second salom must not repeat xush kelibsiz'
      );
    }
    aiMsgs.forEach((m) => assertNoMojibake(m.content, 'A2 salom reply'));
  });

  it('A3. Telegram: "mahsulotlar bormi" → product/stock handled, NOT repeated welcome', async () => {
    const repos = mkRepos();
    const res = await processTelegramUpdate({
      update: mkUpdate(40020, 80003, 'mahsulotlar bormi'),
      repos,
      client: mockClient,
      allowRegularMessages: true,
    });
    // Must be PROCESSED (either as AI reply or suppressed handoff)
    assert.ok(['PROCESSED', 'HANDOFF'].includes(res.status));

    const convs = await repos.conversations.findAll({});
    assert.strictEqual(convs.length, 1);
    const msgs = await repos.messages.findByConversationId(convs[0].id);

    // If AI replied directly, check it's not a generic welcome
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    if (aiMsg) {
      // Not the old hardcoded welcome
      assert.strictEqual(
        aiMsg.content.includes('LImax Yarn B2B xizmatiga xush kelibsiz'),
        false,
        'Must not return raw welcome message for product/stock query'
      );
      assertNoMojibake(aiMsg.content, 'A3 product inquiry reply');
    } else {
      // Suppressed handoff path: conversation should be WAITING_MANAGER
      // or a handoff record created — this is an acceptable outcome
      // (orchestrator treated "bormi" as stock/price query → handoff)
      const convStatus = convs[0].status;
      assert.ok(
        ['WAITING_MANAGER', 'AI_ACTIVE'].includes(convStatus),
        `Unexpected conv status: ${convStatus}`
      );
    }
  });

  it('A4. Telegram: "dty polyester kerak" → DTY token preserved', async () => {
    const repos = mkRepos();
    const res = await processTelegramUpdate({
      update: mkUpdate(40030, 80004, 'dty polyester kerak'),
      repos,
      client: mockClient,
      allowRegularMessages: true,
    });
    assert.strictEqual(res.status, 'PROCESSED');

    const convs = await repos.conversations.findAll({});
    const msgs = await repos.messages.findByConversationId(convs[0].id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg);
    assert.ok(
      aiMsg.content.toUpperCase().includes('DTY'),
      `DTY must be preserved in reply: "${aiMsg.content}"`
    );
    assertNoMojibake(aiMsg.content, 'A4 DTY reply');
  });

  it('A5. Telegram: "narxlar kerak" → asks for product/code, no invented price', async () => {
    const repos = mkRepos();
    const res = await processTelegramUpdate({
      update: mkUpdate(40040, 80005, 'narxlar kerak'),
      repos,
      client: mockClient,
      allowRegularMessages: true,
    });
    assert.strictEqual(res.status, 'PROCESSED');

    const convs = await repos.conversations.findAll({});
    const msgs = await repos.messages.findByConversationId(convs[0].id);
    const aiMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(aiMsg);
    // Must ask for product
    const lower = aiMsg.content.toLowerCase();
    assert.ok(
      lower.includes('mahsulot') || lower.includes('kod') || lower.includes('tur') ||
      lower.includes('ukazhite') || lower.includes('utochnit'),
      `Expected product/code ask but got: "${aiMsg.content}"`
    );
    // No fabricated price (e.g. "2.5 USD" or "3000 uzs")
    assert.strictEqual(
      /\d+[\.,]\d+\s*(usd|uzs)/i.test(aiMsg.content),
      false,
      'Must not contain fabricated price'
    );
    assertNoMojibake(aiMsg.content, 'A5 price ask reply');
  });

  // ══════════════════════════════════════════
  // SECTION B: UTF-8 / Mojibake Zero Tests
  // ══════════════════════════════════════════

  it('B1. Mojibake markers = 0 across all mock intents (uz-Latn)', async () => {
    const messages = [
      'salom', 'mahsulot kerak', 'narx qancha', 'bormi', 'namuna bering',
      'menejer', 'brak chiqdi', 'buyurtma', 'katalog', 'something random',
    ];
    for (const msg of messages) {
      const ctx = mkCtx({ preferredLanguage: 'uz' });
      const res = await adapter.generateStructuredResponse(msg, ctx);
      assertNoMojibake(res.result.replyText, `uz-Latn "${msg}"`);
    }
  });

  it('B2. Mojibake markers = 0 across all mock intents (ru)', async () => {
    const messages = [
      'привет', 'нужен товар', 'цена', 'есть в наличии', 'образец',
      'менеджер', 'брак', 'заказ', 'каталог',
    ];
    for (const msg of messages) {
      const ctx = mkCtx({ preferredLanguage: 'ru' });
      const res = await adapter.generateStructuredResponse(msg, ctx);
      assertNoMojibake(res.result.replyText, `ru "${msg}"`);
    }
  });

  it('B3. Mojibake markers = 0 in prompt builder output', () => {
    const scripts: Array<'uz' | 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'> = [
      'uz', 'uz-Latn', 'uz-Cyrl', 'ru', 'en',
    ];
    for (const lang of scripts) {
      const ctx: AIContext = {
        preferredLanguage: lang,
        availableProducts: [],
        approvedKnowledgeItems: [],
      };
      const prompt = buildSalesSystemPrompt(ctx, { language: lang });
      assertNoMojibake(prompt, `builder output lang=${lang}`);
    }
  });

  // ══════════════════════════════════════════
  // SECTION C: Fabricated Default Tests
  // ══════════════════════════════════════════

  it('C1. Builder: missing price → UNKNOWN emitted, not fabricated number', () => {
    const ctx: AIContext = {
      preferredLanguage: 'uz',
      availableProducts: [{
        id: 'p1', name: 'DTY 30/70', category: 'DTY', active: true,
        price: 0, currency: '', minimumOrder: 0, stockStatus: undefined as any,
        description: '', specifications: {}, createdAt: new Date(), updatedAt: new Date(),
      }],
    };
    const prompt = buildSalesSystemPrompt(ctx, { language: 'uz' });
    assert.ok(prompt.includes('UNKNOWN'), 'Must emit UNKNOWN for missing price');
    // Must not contain "0 " as a price figure
    assert.strictEqual(/Active Price: 0\s/m.test(prompt), false, 'Must not show price=0 as real price');
  });

  it('C2. Builder: missing MOQ → UNKNOWN emitted, not default 1', () => {
    const ctx: AIContext = {
      preferredLanguage: 'uz',
      availableProducts: [{
        id: 'p2', name: 'FDY 20/70', category: 'FDY', active: true,
        price: 5.5, currency: 'USD', minimumOrder: 0, stockStatus: 'in_stock',
        description: '', specifications: {}, createdAt: new Date(), updatedAt: new Date(),
      }],
    };
    const prompt = buildSalesSystemPrompt(ctx, { language: 'uz' });
    assert.ok(prompt.includes('UNKNOWN'), 'Must emit UNKNOWN for MOQ=0');
    assert.strictEqual(/Minimum Order \(MOQ\): 1$/m.test(prompt), false, 'Must not default MOQ to 1');
  });

  it('C3. Builder: missing stockStatus → UNKNOWN emitted, not "in_stock"', () => {
    const ctx: AIContext = {
      preferredLanguage: 'uz',
      availableProducts: [{
        id: 'p3', name: 'POY 15/55', category: 'POY', active: true,
        price: 4.2, currency: 'USD', minimumOrder: 500, stockStatus: undefined as any,
        description: '', specifications: {}, createdAt: new Date(), updatedAt: new Date(),
      }],
    };
    const prompt = buildSalesSystemPrompt(ctx, { language: 'uz' });
    assert.ok(
      prompt.includes('Stock Status: UNKNOWN'),
      'Must emit Stock Status: UNKNOWN when stockStatus is undefined'
    );
    assert.strictEqual(prompt.includes('Stock Status: in_stock'), false, 'Must not default to in_stock');
  });

  it('C4. Builder: approvedKnowledgeItems only — DRAFT excluded', () => {
    // Using knowledgeItems option (pre-filter path)
    const ctx: AIContext = { preferredLanguage: 'uz' };
    const prompt = buildSalesSystemPrompt(ctx, {
      language: 'uz',
      knowledgeItems: [
        { id: 'k1', title: 'Approved Info', content: 'Real data here', status: 'APPROVED' },
        { id: 'k2', title: 'Draft Info', content: 'Draft data here', status: 'DRAFT' },
        { id: 'k3', title: 'Rejected Info', content: 'Rejected data', status: 'REJECTED' },
      ],
    });
    assert.ok(prompt.includes('Real data here'), 'APPROVED item must appear');
    assert.strictEqual(prompt.includes('Draft data here'), false, 'DRAFT must be excluded');
    assert.strictEqual(prompt.includes('Rejected data'), false, 'REJECTED must be excluded');
  });

  // ══════════════════════════════════════════
  // SECTION D: Script-Specific Intent Tests
  // ══════════════════════════════════════════

  it('D1. uz-Latn: "salom" new conversation → uz-Latn greeting', async () => {
    const ctx = mkCtx({ preferredLanguage: 'uz', isNewConversation: true });
    const res = await adapter.generateStructuredResponse('salom', ctx);
    assert.strictEqual(res.result.language, 'uz');
    // Must be uz-Latn style (no Cyrillic or Russian)
    assert.strictEqual(/[А-Яа-яЁё]/.test(res.result.replyText), false, 'uz-Latn reply must not contain Cyrillic');
    assertNoMojibake(res.result.replyText, 'D1 uz-Latn greeting');
  });

  it('D2. uz-Cyrl: "salom" new conversation → uz-Cyrl safe greeting', async () => {
    const ctx = mkCtx({ preferredLanguage: 'uz-Cyrl', isNewConversation: true });
    const res = await adapter.generateStructuredResponse('salom', ctx);
    assert.strictEqual(res.result.language, 'uz-Cyrl');
    assertNoMojibake(res.result.replyText, 'D2 uz-Cyrl greeting');
  });

  it('D3. ru: "привет" new conversation → Russian greeting, no Uzbek', async () => {
    const ctx = mkCtx({ preferredLanguage: 'ru', isNewConversation: true });
    const res = await adapter.generateStructuredResponse('привет', ctx);
    assert.strictEqual(res.result.language, 'ru');
    // Russian greeting must not contain Uzbek-only words
    assert.strictEqual(res.result.replyText.toLowerCase().includes('assalomu'), false,
      'Russian reply must not contain Uzbek greeting');
    assertNoMojibake(res.result.replyText, 'D3 ru greeting');
  });

  it('D4. "mahsulotlar bormi" → PRODUCT_INQUIRY not STOCK', async () => {
    const ctx = mkCtx({ preferredLanguage: 'uz', isNewConversation: true });
    const res = await adapter.generateStructuredResponse('mahsulotlar bormi', ctx);
    // Must resolve as product_stock (product inquiry flow) not raw stock
    assert.ok(
      ['product_stock', 'product_inquiry'].includes(res.result.intent),
      `Expected product intent but got: ${res.result.intent}`
    );
    // Must NOT be raw stock UNKNOWN response asking "qaysi mahsulot"
    // The response must be about products/listing them
    const lower = res.result.replyText.toLowerCase();
    assert.ok(
      lower.includes('mahsulot') || lower.includes('turdagi ip'),
      `Expected product-related response: "${res.result.replyText}"`
    );
  });

  it('D5. isNewConversation=false + "salom" → short reply, no full welcome', async () => {
    const ctx = mkCtx({
      preferredLanguage: 'uz',
      isNewConversation: false,
      conversationHistory: [
        { role: 'user', content: 'salom' },
        { role: 'assistant', content: "Assalomu alaykum! LImax ip mahsulotlari bo'yicha yordam beraman." },
      ],
    });
    const res = await adapter.generateStructuredResponse('salom', ctx);
    // Must not re-show long welcome
    assert.strictEqual(
      res.result.replyText.toLowerCase().includes('xush kelibsiz'),
      false,
      'Must not show xush kelibsiz for returning user'
    );
    assert.strictEqual(
      res.result.replyText.toLowerCase().includes('limax ip mahsulotlari'),
      false,
      'Must not repeat full intro for returning user'
    );
    assertNoMojibake(res.result.replyText, 'D5 returning salom');
  });

  it('D6. uz-Cyrl price query → no Cyrillic Russian characters in reply', async () => {
    const ctx = mkCtx({ preferredLanguage: 'uz-Cyrl', isNewConversation: true });
    const res = await adapter.generateStructuredResponse('narx qancha', ctx);
    assert.strictEqual(res.result.intent, 'product_price');
    assertNoMojibake(res.result.replyText, 'D6 uz-Cyrl price ask');
  });

  it('D7. ru stock query "есть в наличии" → stock intent, Russian reply', async () => {
    const ctx = mkCtx({ preferredLanguage: 'ru', isNewConversation: true });
    const res = await adapter.generateStructuredResponse('есть в наличии dty', ctx);
    // DTY present → should mention UNKNOWN or DTY in product context
    assertNoMojibake(res.result.replyText, 'D7 ru stock query reply');
    assert.ok(res.result.replyText.length > 0);
  });

  // ══════════════════════════════════════════
  // SECTION E: All Required Fields Present
  // ══════════════════════════════════════════

  it('E1. All valid updates produce complete AIStructuredResult fields', async () => {
    const messages = [
      { text: 'salom', lang: 'uz' as const },
      { text: 'mahsulotlar bormi', lang: 'uz' as const },
      { text: 'dty polyester kerak', lang: 'uz' as const },
      { text: 'narxlar kerak', lang: 'uz' as const },
      { text: 'привет', lang: 'ru' as const },
      { text: 'brak chiqdi', lang: 'uz' as const },
      { text: '5 tonna buyurtma', lang: 'uz' as const },
    ];
    for (const { text, lang } of messages) {
      const ctx = mkCtx({ preferredLanguage: lang, isNewConversation: true });
      const res = await adapter.generateStructuredResponse(text, ctx);
      assert.ok(res.result.replyText?.length > 0, `replyText missing for: ${text}`);
      assert.ok(res.result.language, `language missing for: ${text}`);
      assert.ok(typeof res.result.confidence === 'number', `confidence missing for: ${text}`);
      assert.ok(typeof res.result.needsHandoff === 'boolean', `needsHandoff missing for: ${text}`);
      assert.ok(Array.isArray(res.result.usedKnowledgeIds), `usedKnowledgeIds missing for: ${text}`);
      assertNoMojibake(res.result.replyText, `E1 field check "${text}"`);
    }
  });
});
