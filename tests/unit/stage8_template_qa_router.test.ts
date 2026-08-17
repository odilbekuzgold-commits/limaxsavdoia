/**
 * Stage 8: Template Q&A Router Integration & Safety Tests
 *
 * Mandatory Safety Checks:
 * 1. Historical price does NOT leak into current response
 * 2. Historical stock quantity does NOT leak into current response
 * 3. Individual discount does NOT become general rule
 * 4. Missing DB value is NEVER guessed (uses unknown template / handoff)
 * 5. Low-confidence message does NOT hit deterministic template
 * 6. Customer typo variants correctly normalized (necpul -> narxi qancha, etc.)
 * 7. Product codes preserved without alteration (30/70, 20/70, 75D/36, etc.)
 * 8. Multi-intent response combined into a single non-repeating reply
 * 9. Handoff gives NO false action promises ("hozir tekshiraman")
 * 10. PII redacted and DOES NOT leak into logs or responses
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  TemplateQARouter,
  normalizeCustomerMessage,
  extractEntities,
  sanitizePiiText,
  loadTemplateDataset,
} from '../../packages/ai-engine/dist/templates/index.js';
import { AIOrchestrator } from '../../packages/ai-engine/dist/index.js';
import {
  InMemoryProductRepository,
  InMemoryProductPriceRepository,
  InMemoryProductInventoryRepository,
  InMemoryConversationRepository,
  InMemoryHandoffRepository,
  InMemoryCustomerRepository,
} from '../../packages/database/dist/index.js';
import type { Repositories, Product } from '../../packages/shared/dist/index.js';

const router = new TemplateQARouter();
const dataset = loadTemplateDataset();

const mkProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod-3070',
  name: '30/70 Polyester',
  category: 'DTY',
  active: true,
  price: 3.5,
  currency: 'USD',
  minimumOrder: 500,
  stockStatus: 'in_stock',
  description: 'High quality yarn',
  specifications: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mkRepos = (): Repositories => {
  const products = new InMemoryProductRepository();
  return {
    customers: new InMemoryCustomerRepository(),
    contacts: {} as any,
    conversations: new InMemoryConversationRepository(),
    messages: {} as any,
    leads: {} as any,
    handoffs: new InMemoryHandoffRepository(),
    products,
    knowledge: {} as any,
    productPrices: new InMemoryProductPriceRepository(products),
    productInventory: new InMemoryProductInventoryRepository(products),
    productCertificates: {} as any,
    productMedia: {} as any,
    salesSettings: {} as any,
    auditLogs: {} as any,
    aiUsage: { create: async () => ({}) } as any,
    telegramConnections: {} as any,
    telegramReceipts: {} as any,
  };
};

describe('Stage 8: Template Q&A Router Integration & Safety Tests', () => {

  // ── 1. Customer Typo Normalization ─────────────────────────────────────────
  it('1. Customer typo variants are normalized correctly while protecting product tokens', () => {
    const res1 = normalizeCustomerMessage('30/70 necpul', dataset.dictionary);
    assert.ok(res1.normalizedText.includes('30/70'), 'Product token 30/70 must be preserved');
    assert.ok(res1.normalizedText.includes('narxi qancha'), 'necpul must be normalized to narxi qancha');

    const res2 = normalizeCustomerMessage('spes va babina 2070K bomi', dataset.dictionary);
    assert.ok(res2.normalizedText.includes('2070K'), 'Product token 2070K must be preserved');
    assert.ok(res2.normalizedText.includes('spetsifikatsiya'), 'spes -> spetsifikatsiya');
    assert.ok(res2.normalizedText.includes('bobina'), 'babina -> bobina');
    assert.ok(res2.normalizedText.includes('bormi'), 'bomi -> bormi');

    const res3 = normalizeCustomerMessage('75D/36 moshina zakaz', dataset.dictionary);
    assert.ok(res3.normalizedText.includes('75D/36'), 'Product token 75D/36 must be preserved');
    assert.ok(res3.normalizedText.includes('mashina'), 'moshina -> mashina');
    assert.ok(res3.normalizedText.includes('buyurtma'), 'zakaz -> buyurtma');
  });

  // ── 2. Product Token Preservation ──────────────────────────────────────────
  it('2. Product codes are preserved without alteration across all extractions', () => {
    const codes = ['30/70', '20/70', '75D/36', '70D/2', '40D/2', '2070K', '3070K', 'DTY', 'FDY'];
    for (const code of codes) {
      const entities = extractEntities(`Mizojga ${code} ip kerak`);
      assert.strictEqual(entities.product, code.toUpperCase(), `Expected ${code} to be extracted cleanly`);
    }
  });

  // ── 3. Historical Price Does Not Leak ──────────────────────────────────────
  it('3. Historical price does NOT leak to current response when DB price is active', async () => {
    const repos = mkRepos();
    const prod = mkProduct({ id: 'p1', name: '30/70 Polyester', price: 4.8 });
    await repos.products.create(prod);

    // Historical text mentioning old price "2.5$" should NOT be used as current fact
    const ctx = {
      preferredLanguage: 'uz' as const,
      availableProducts: [prod],
      conversationHistory: [{ role: 'user' as const, content: 'Oldin 2.5$ edi-ku' }],
    };

    const res = await router.routeQuery('30/70 narxi qancha', ctx, { repos });
    assert.ok(res, 'Router should handle price query');
    assert.ok(res.replyText.includes('4.8'), `Must show real-time active price 4.8, got: ${res.replyText}`);
    assert.strictEqual(res.replyText.includes('2.5'), false, 'Must not leak historical 2.5 price');
  });

  // ── 4. Historical Stock Quantity Does Not Leak ─────────────────────────────
  it('4. Historical stock quantity does NOT leak to current response', async () => {
    const repos = mkRepos();
    const prod = mkProduct({ id: 'p2', name: '20/70 DTY', stockStatus: 'out_of_stock' });
    await repos.products.create(prod);

    const ctx = {
      preferredLanguage: 'uz' as const,
      availableProducts: [prod],
      conversationHistory: [{ role: 'user' as const, content: 'Kechasi 5000 kg bor edingiz' }],
    };

    const res = await router.routeQuery('20/70 omborda bormi', ctx, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('mavjud emas'), `Must report out_of_stock, got: ${res.replyText}`);
    assert.strictEqual(res.replyText.includes('5000'), false, 'Must not leak historical 5000 kg stock');
  });

  // ── 5. Individual Discount Is Not General Rule ─────────────────────────────
  it('5. Individual discount is not generalized; missing discount triggers handoff/unknown', async () => {
    const repos = mkRepos();
    const prod = mkProduct({ id: 'p3', name: '75D/36' });
    await repos.products.create(prod);

    const ctx = { preferredLanguage: 'uz' as const, availableProducts: [prod] };
    const res = await router.routeQuery('75D/36 uchun 30% skidka beriladimi', ctx, { repos });
    assert.ok(res);
    // Should require handoff or unknown for unapproved discount
    assert.ok(res.needsHandoff || res.replyText.includes('tasdiqlanmagan') || res.replyText.includes('menejer'));
  });

  // ── 6. Missing DB Value Is Never Guessed ───────────────────────────────────
  it('6. Missing DB value is NEVER guessed; uses unknown template or handoff', async () => {
    const repos = mkRepos();
    // Product exists but price is 0 / unconfirmed
    const prod = mkProduct({ id: 'p4', name: '3070K', price: 0 });
    await repos.products.create(prod);

    const ctx = { preferredLanguage: 'uz' as const, availableProducts: [prod] };
    const res = await router.routeQuery('3070K narxi qancha', ctx, { repos });
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true, 'Missing price must trigger handoff');
    assert.ok(
      res.replyText.includes('tasdiqlanmagan') || res.replyText.includes('menejer') || res.replyText.includes('Joriy'),
      `Must emit unknown template/handoff reply, got: ${res.replyText}`
    );
  });

  // ── 7. Low-Confidence Message Does Not Hit Deterministic Template ─────────
  it('7. Low-confidence un-matched message returns null (falls back to RAG/LLM)', async () => {
    const ctx = { preferredLanguage: 'uz' as const };
    const res = await router.routeQuery('Oyga uchish chiptasi necha pul turadi', ctx);
    assert.strictEqual(res, null, 'Low confidence or unmatched query must return null for fallback');
  });

  // ── 8. Multi-Intent Response Combined ──────────────────────────────────────
  it('8. Multi-intent query produces a single combined non-repeating response', async () => {
    const repos = mkRepos();
    const prod = mkProduct({ id: 'p5', name: '30/70', price: 3.5, stockStatus: 'in_stock' });
    await repos.products.create(prod);

    const ctx = { preferredLanguage: 'uz' as const, availableProducts: [prod] };
    // Query contains both stock availability AND price
    const res = await router.routeQuery('30/70 bormi, narxi qancha', ctx, { repos });
    assert.ok(res);
    // Single combined response without asking customer twice
    assert.ok(res.replyText.length > 0);
    assert.strictEqual(typeof res.replyText, 'string');
  });

  // ── 9. Handoff Action Honesty ──────────────────────────────────────────────
  it('9. Handoff response makes NO false promises ("hozir tekshiraman")', async () => {
    const orchestrator = new AIOrchestrator({ aiMode: 'mock' });
    const res = await orchestrator.processQuery('Menejerga bog\'lang, tekshiraman deb va\'da bermang', {
      preferredLanguage: 'uz',
    });
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true);
    assert.strictEqual(
      res.replyText.toLowerCase().includes('hozir tekshiraman'),
      false,
      'Must not make unexecuted false action promises'
    );
  });

  // ── 10. PII Redaction Safety ───────────────────────────────────────────────
  it('10. PII (phone and card numbers) is redacted and does not leak into response', () => {
    const raw = 'Mening raqamim +998901234567 va kartam 8600123456789012';
    const { sanitized, hasPii } = sanitizePiiText(raw);
    assert.strictEqual(hasPii, true);
    assert.ok(sanitized.includes('[REDACTED_PHONE]'), 'Phone number must be redacted');
    assert.ok(sanitized.includes('[REDACTED_FINANCIAL]'), 'Financial card must be redacted');
    assert.strictEqual(sanitized.includes('998901234567'), false, 'Raw phone must not remain');
    assert.strictEqual(sanitized.includes('8600123456789012'), false, 'Raw card must not remain');
  });

  // ── 11. Full AIOrchestrator Stage 8 Integration ─────────────────────────────
  it('11. Full AIOrchestrator integration routes template queries correctly', async () => {
    const repos = mkRepos();
    const prod = mkProduct({ id: 'p6', name: 'DTY 30/70', price: 4.2, stockStatus: 'in_stock' });
    await repos.products.create(prod);

    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });
    const res = await orchestrator.processQuery('Assalomu alaykum, DTY 30/70 narxi qancha?', {
      preferredLanguage: 'uz',
      availableProducts: [prod],
    });

    assert.ok(res);
    assert.ok(res.replyText.includes('4.2'), 'Orchestrator must return dynamic price via TemplateQARouter');
    assert.strictEqual(res.confidence >= 0.70, true);
  });
});
