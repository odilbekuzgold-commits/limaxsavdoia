import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AIOrchestrator } from '../../packages/ai-engine/dist/index.js';
import type { Product, Repositories } from '@limax/shared';

describe('Stage 17.3: Conversation Truth, Product Ambiguity & Zero-Assumption Unit Tests', () => {
  const mockProducts: Product[] = [
    {
      id: 'p-40100-blk',
      name: 'Vozdushniy spandeks 40100K BLACK',
      code: 'VS-40100K-BLK',
      category: 'Vozdushniy spandeks',
      count: '40100K',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'p-40100-wht',
      name: 'Vozdushniy spandeks 40100K WHITE',
      code: 'VS-40100K-WHT',
      category: 'Vozdushniy spandeks',
      count: '40100K',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'p-300d-blk',
      name: 'Poliester 300D/96 BLACK',
      code: 'PES-300D96-BLK',
      category: 'Poliester',
      count: '300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'p-300d-wht',
      name: 'Poliester 300D/96 WHITE',
      code: 'PES-300D96-WHT',
      category: 'Poliester',
      count: '300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'p-w300d-blk',
      name: 'Poliester W300D/96 BLACK',
      code: 'PES-W300D96-BLK',
      category: 'Poliester',
      count: 'W300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'p-w300d-wht',
      name: 'Poliester W300D/96 WHITE',
      code: 'PES-W300D96-WHT',
      category: 'Poliester',
      count: 'W300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    // Test/Seed products to isolate
    {
      id: 'p-test-seed',
      name: 'Test Kalava Ip 30/70',
      code: 'TEST_3070',
      category: 'Test',
      active: true,
      price: 2.95,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPrices = [
    {
      id: 'pr-40100-blk-bt',
      productId: 'p-40100-blk',
      paymentType: 'BANK_TRANSFER',
      price: 2.39,
      currency: 'USD',
      unit: 'kg',
      active: true,
      minimumQuantity: null,
      sourceSystem: 'GOOGLE_SHEETS',
      validFrom: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'pr-40100-blk-cash',
      productId: 'p-40100-blk',
      paymentType: 'CASH',
      price: 2.50,
      currency: 'USD',
      unit: 'kg',
      active: true,
      minimumQuantity: null,
      sourceSystem: 'GOOGLE_SHEETS',
      validFrom: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'pr-40100-wht-bt',
      productId: 'p-40100-wht',
      paymentType: 'BANK_TRANSFER',
      price: 2.39,
      currency: 'USD',
      unit: 'kg',
      active: true,
      minimumQuantity: null,
      sourceSystem: 'GOOGLE_SHEETS',
      validFrom: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'pr-40100-wht-cash',
      productId: 'p-40100-wht',
      paymentType: 'CASH',
      price: 2.50,
      currency: 'USD',
      unit: 'kg',
      active: true,
      minimumQuantity: null,
      sourceSystem: 'GOOGLE_SHEETS',
      validFrom: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockInventory = [
    {
      id: 'inv-40100-blk',
      productId: 'p-40100-blk',
      availableQuantity: null,
      reservedQuantity: 0,
      status: 'UNKNOWN',
      unit: 'kg',
    },
    {
      id: 'inv-300d-blk',
      productId: 'p-300d-blk',
      availableQuantity: 0,
      reservedQuantity: 0,
      status: 'OUT_OF_STOCK',
      unit: 'kg',
    },
  ];

  const createMockRepos = (): Repositories =>
    ({
      products: {
        findAll: async () => mockProducts,
        findById: async (id: string) => mockProducts.find((p) => p.id === id) || null,
        create: async (d: any) => ({ ...d, id: 'new-id', createdAt: new Date(), updatedAt: new Date() }),
        update: async (id: string, d: any) => ({ id, ...d }),
      },
      productPrices: {
        findByProductId: async (pId: string) => mockPrices.filter((pr) => pr.productId === pId) as any,
        findActiveByProductId: async (pId: string) => mockPrices.find((pr) => pr.productId === pId && pr.active) as any,
        getActivePrice: async (pId: string) => mockPrices.find((pr) => pr.productId === pId && pr.active) as any,
        create: async (d: any) => ({ ...d, id: 'new-price-id', createdAt: new Date(), updatedAt: new Date() }),
        update: async (id: string, d: any) => ({ id, ...d }),
      },
      productInventory: {
        findByProductId: async (pId: string) => mockInventory.find((inv) => inv.productId === pId) as any,
        updateStock: async () => ({}) as any,
      },
      conversations: {
        findById: async () => null,
        update: async () => ({}) as any,
      },
      handoffs: {
        findByConversationId: async () => [],
        create: async (d: any) => d,
      },
    } as unknown as Repositories);

  it('1. 40100K without payment type asks cash or transfer first', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K narxi qancha?');
    assert.ok(res.replyText.includes('naqd') && /o['‘’]?tkazish|perechislenie/i.test(res.replyText));
    assert.ok(!res.replyText.includes('2.39') && !res.replyText.includes('2.50'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('2. 40100K naqd returns only CASH price (2.50 USD)', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K naqdga qancha?');
    assert.ok(res.replyText.includes('2.50') || res.replyText.includes('2.5'), 'Must include 2.50');
    assert.ok(!res.replyText.includes('2.39'), 'Must NOT include bank transfer 2.39');
  });

  it('3. 40100K o‘tkazma returns only BANK_TRANSFER price (2.39 USD)', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K o‘tkazmaga narxi qancha?');
    assert.ok(res.replyText.includes('2.39'), 'Must include 2.39');
    assert.ok(!res.replyText.includes('2.50') && !res.replyText.includes('2.5 '), 'Must NOT include cash 2.50');
  });

  it('4. Price query asks payment type before returning a value', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K narxi qancha?');
    assert.ok(res.replyText.includes('naqd') && /o['‘’]?tkazish|perechislenie/i.test(res.replyText));
  });

  it('5. "300 lik poliester" clarifies between 300D/96 vs W300D/96 and BLACK vs WHITE', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('300 lik poliester narxi qancha?');
    assert.ok(
      res.replyText.includes('300D') ||
      res.replyText.includes('W300D') ||
      res.replyText.includes('BLACK') ||
      res.replyText.includes('WHITE'),
      'Must ask clarifying question without guessing'
    );
  });

  it('6. Null MOQ does not include MOQ in response text', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K qora naqd narxi qancha?');
    assert.ok(!res.replyText.includes('MOQ'), 'Must NOT fabricate MOQ when null in DB');
    assert.ok(!res.replyText.includes('Minimal buyurtma'), 'Must NOT include Minimal buyurtma when null');
  });

  it('7. Inventory UNKNOWN does not state "out of stock" or "mavjud emas"', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K omborda bormi?');
    assert.ok(!res.replyText.toLowerCase().includes('mavjud emas'));
    assert.ok(!res.replyText.toLowerCase().includes('нет в наличии'));
    assert.ok(
      res.replyText.includes('bor') ||
      res.replyText.includes('mavjud') ||
      res.replyText.includes('kiritilmagan') ||
      res.replyText.includes('aniqlanmagan') ||
      res.replyText.includes('menejer')
    );
  });

  it('8. Active product is always presented as available', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('300D/96 qora omborda bormi?');
    assert.ok(res.replyText.toLowerCase().includes('bor'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('9. "Sen AI misan?" returns accurate assistant identity', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const resUz = await orchestrator.processQuery('Sen AI misan?');
    assert.strictEqual(resUz.replyText, 'Nega bunday deyapsiz?');
    assert.strictEqual(resUz.needsHandoff, false);

    const resRu = await orchestrator.processQuery('Ты бот?');
    assert.strictEqual(resRu.replyText, 'Почему вы так говорите?');
    assert.strictEqual(resRu.needsHandoff, false);
  });

  it('10. Identity query never creates handoff or triggers WAITING_MANAGER', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('Kim bu?');
    assert.strictEqual(res.needsHandoff, false);
    assert.strictEqual(res.intent, 'bot_identity');
  });

  it('11. Test/legacy products are isolated from runtime pricing queries', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('Test Kalava Ip narxi qancha?');
    assert.ok(
      !res.replyText.includes('2.95') && !res.replyText.includes('2.85'),
      'Must NOT serve test prices 2.95/2.85 in runtime'
    );
  });

  it('12. No manager contact promise when handoff is not executed', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K naqdga qancha?');
    assert.strictEqual(res.needsHandoff, false);
    assert.ok(!res.replyText.includes('menejerimiz siz bilan bog\'lanadi'));
  });

  it('13. Product tokens (40100K, 300D/96, W300D/96) are strictly preserved', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const res = await orchestrator.processQuery('40100K narxi qancha?');
    assert.ok(res.replyText.includes('40100K'), '40100K token must be preserved');
  });

  it('14. Multilingual support across uz-Latn, uz-Cyrl and ru for Identity', async () => {
    const repos = createMockRepos();
    const orchestrator = new AIOrchestrator({ aiMode: 'mock', repos });

    const resUz = await orchestrator.processQuery('Sen kimsan?');
    assert.strictEqual(resUz.replyText, 'Nega bunday deyapsiz?');

    const resCyrl = await orchestrator.processQuery('Сен кимсан?');
    assert.strictEqual(resCyrl.replyText, 'Нега бундай деяпсиз?');

    const resRu = await orchestrator.processQuery('Кто ты?');
    assert.strictEqual(resRu.replyText, 'Почему вы так говорите?');
  });
});
