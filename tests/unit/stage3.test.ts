import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  CustomerSchema,
  ConversationStatusEnum,
  MessageStatusEnum,
  ProductSchema,
} from '../../packages/shared/dist/index.js';
import {
  calculateLeadScore,
  detectLanguage,
  matchProducts,
  applyGuardrails,
  MockAIProvider,
} from '../../packages/ai-engine/dist/index.js';

describe('Stage 3: Business & AI Unit Tests', () => {
  test('1. Customer validation schema', () => {
    const valid = CustomerSchema.safeParse({
      id: '11111111-1111-4111-a111-111111111111',
      name: 'Test Business Client',
      preferredLanguage: 'uz',
      status: 'active',
      tags: ['b2b'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.strictEqual(valid.success, true);

    const invalid = CustomerSchema.safeParse({
      name: '', // Empty name
    });
    assert.strictEqual(invalid.success, false);
  });

  test('2. Conversation state transitions', () => {
    assert.strictEqual(ConversationStatusEnum.parse('AI_ACTIVE'), 'AI_ACTIVE');
    assert.strictEqual(ConversationStatusEnum.parse('WAITING_MANAGER'), 'WAITING_MANAGER');
    assert.throws(() => ConversationStatusEnum.parse('INVALID_STATE'));
  });

  test('3. Message status transitions', () => {
    assert.strictEqual(MessageStatusEnum.parse('RECEIVED'), 'RECEIVED');
    assert.strictEqual(MessageStatusEnum.parse('PROCESSING'), 'PROCESSING');
    assert.strictEqual(MessageStatusEnum.parse('SENT'), 'SENT');
    assert.throws(() => MessageStatusEnum.parse('UNKNOWN_STATUS'));
  });

  test('4. Lead score calculation (COLD, WARM, HOT)', () => {
    const cold = calculateLeadScore({
      needMatchScore: 10,
      timelineScore: 5,
      budgetScore: 5,
      authorityScore: 5,
      activityScore: 5,
      regionScore: 5,
      contactScore: 5,
    });
    assert.strictEqual(cold.score, 40);
    assert.strictEqual(cold.temperature, 'COLD');
    assert.strictEqual(cold.recommendHandoff, false);

    const hot = calculateLeadScore({
      needMatchScore: 25,
      timelineScore: 20,
      budgetScore: 15,
      authorityScore: 10,
      activityScore: 10,
      regionScore: 10,
      contactScore: 10,
    });
    assert.strictEqual(hot.score, 100);
    assert.strictEqual(hot.temperature, 'HOT');
    assert.strictEqual(hot.recommendHandoff, true);
  });

  test('5. Product matching logic', () => {
    const products = [
      {
        id: '11111111-1111-4111-a111-111111111111',
        name: 'Cotton Yarn Open-End',
        category: 'Textile',
        description: 'Quality cotton yarn',
        price: 2.5,
        currency: 'USD',
        minimumOrder: 100,
        stockStatus: 'in_stock' as const,
        media: [],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const matched = matchProducts('cotton', products);
    assert.strictEqual(matched.length, 1);

    const unmatched = matchProducts('silk', products);
    assert.strictEqual(unmatched.length, 0);
  });

  test('6. Language detection (uz, ru, en, zh, tg, kk, ky)', () => {
    assert.strictEqual(detectLanguage('Assalomu alaykum, narxi qancha?'), 'uz');
    assert.strictEqual(detectLanguage('Здравствуйте, какая цена?'), 'ru');
    assert.strictEqual(detectLanguage('Hello, what is the price?'), 'en');
    assert.strictEqual(detectLanguage('你好，价格是多少？'), 'zh');
    assert.strictEqual(detectLanguage('Салом, нархи чанд?'), 'tg');
    assert.strictEqual(detectLanguage('Сәлем, бағасы қанша?'), 'kk');
    assert.strictEqual(detectLanguage('Салам, баасы канча?'), 'ky');
  });

  test('7. Guardrails: Forbidden topics (Religion/Politics)', () => {
    const guard = applyGuardrails('Siz qaysi siyosiy partiyaga ovoz berasiz?');
    assert.strictEqual(guard.allowed, false);
    assert.strictEqual(guard.reason, 'FORBIDDEN_TOPIC_POLITICS_RELIGION');
    assert.strictEqual(guard.triggerHandoff, true);
  });

  test('8. Guardrails: Duplicate response prevention', () => {
    const guard = applyGuardrails('Salom!', { lastResponse: 'Salom!' });
    assert.strictEqual(guard.allowed, false);
    assert.strictEqual(guard.reason, 'DUPLICATE_RESPONSE_PREVENTED');
  });

  test('9. Guardrails: Low confidence handoff', () => {
    const guard = applyGuardrails('Murakkab savol', { confidenceScore: 0.4 });
    assert.strictEqual(guard.allowed, true);
    assert.strictEqual(guard.triggerHandoff, true);
    assert.strictEqual(guard.reason, 'LOW_CONFIDENCE');
  });

  test('10. Mock AI Provider generateResponse', async () => {
    const provider = new MockAIProvider();
    const res = await provider.generateResponse('Narxi qancha?', {
      preferredLanguage: 'uz',
      availableProducts: [
        {
          id: '11111111-1111-4111-a111-111111111111',
          name: 'Yarn Ne 20',
          category: 'Textile',
          description: 'Desc',
          price: 3.5,
          currency: 'USD',
          minimumOrder: 1,
          stockStatus: 'in_stock',
          media: [],
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    assert.strictEqual(res.suggestedAction, 'reply');
    assert.strictEqual(res.content.includes('3.5 USD'), true);
  });

  test('11. Invalid request schema rejection', () => {
    const res = ProductSchema.safeParse({
      name: 'Yarn',
      price: -10, // Invalid negative price
    });
    assert.strictEqual(res.success, false);
  });
});
