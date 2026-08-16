import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { TemplateQARouter } from '../../packages/ai-engine/dist/templates/router.js';
import { extractEntities } from '../../packages/ai-engine/dist/templates/extractor.js';
import { normalizeCustomerMessage } from '../../packages/ai-engine/dist/templates/normalizer.js';

describe('Stage 10.2: UTF-8, Localization & Mojibake Regressions', () => {
  const router = new TemplateQARouter();

  const mockContext = {
    conversationId: 'c_stage10_2',
    customerId: 'cust_stage10_2',
    availableProducts: [
      { id: 'p1', name: '30/70', category: 'yarn', price: 2.85, currency: 'USD', stockStatus: 'in_stock', active: true },
      { id: 'p2', name: '75D/36', category: 'yarn', price: 3.10, currency: 'USD', stockStatus: 'in_stock', active: true },
      { id: 'p3', name: '2070K', category: 'yarn', price: 4.50, currency: 'USD', stockStatus: 'in_stock', active: true },
      { id: 'p4', name: '40/1', category: 'yarn', price: 2.20, currency: 'USD', stockStatus: 'in_stock', active: true },
      { id: 'p5', name: '70/1', category: 'yarn', price: 2.60, currency: 'USD', stockStatus: 'in_stock', active: true },
    ],
  };

  // Escaped mojibake markers so test file itself is clean
  const MOJIBAKE_MARKERS = [
    'Ð',
    'Ñ',
    'â\u20ac',
    'â\u20ac\u2122',
    'â\u20ac\u201c',
    'Ê¼',
    'Ã',
    'Â',
    '\uFFFD',
  ];

  function assertNoMojibake(text: string, label: string) {
    for (const marker of MOJIBAKE_MARKERS) {
      assert.ok(!text.includes(marker), `${label} contains mojibake marker "${marker}": "${text}"`);
    }
  }

  // ── 1. The 12 Mandatory Query Tests ─────────────────────────────────────

  it('1. Query "Salom" -> GREETING, uz-Latn, Latin response', async () => {
    const res = await router.routeQuery('Salom', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'GREETING');
    assert.strictEqual(res.language, 'uz');
    assert.strictEqual(res.needsHandoff, false);
    assert.ok(/Assalomu/i.test(res.replyText));
    assertNoMojibake(res.replyText, 'Salom reply');
  });

  it('2. Query "Ассалому алайкум" -> GREETING, uz-Cyrl, Cyrillic response', async () => {
    const res = await router.routeQuery('Ассалому алайкум', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'GREETING');
    assert.strictEqual(res.language, 'uz-Cyrl');
    assert.strictEqual(res.needsHandoff, false);
    assert.ok(/Ассалому/i.test(res.replyText));
    assertNoMojibake(res.replyText, 'Ассалому алайкум reply');
  });

  it('3. Query "Привет" -> GREETING, ru, Russian response', async () => {
    const res = await router.routeQuery('Привет', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'GREETING');
    assert.strictEqual(res.language, 'ru');
    assert.strictEqual(res.needsHandoff, false);
    assert.ok(/Здравствуйте/i.test(res.replyText));
    assertNoMojibake(res.replyText, 'Привет reply');
  });

  it('4. Query "30/70 narxi qancha?" -> product_price, uz-Latn, token preserved', async () => {
    const res = await router.routeQuery('30/70 narxi qancha?', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'product_price');
    assert.strictEqual(res.language, 'uz');
    assert.strictEqual(res.leadSignals?.productNeed, '30/70');
    assert.ok(res.replyText.includes('30/70'));
    assert.ok(res.replyText.includes('2.85 USD'));
    assertNoMojibake(res.replyText, '30/70 narxi reply');
  });

  it('5. Query "30/70 нархи қанча?" -> product_price, uz-Cyrl, Cyrillic response & token preserved', async () => {
    const res = await router.routeQuery('30/70 нархи қанча?', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'product_price');
    assert.strictEqual(res.language, 'uz-Cyrl');
    assert.strictEqual(res.leadSignals?.productNeed, '30/70');
    assert.ok(res.replyText.includes('30/70'));
    assert.ok(res.replyText.includes('нархи'));
    assertNoMojibake(res.replyText, '30/70 нархи reply');
  });

  it('6. Query "Сколько стоит 30/70?" -> product_price, ru, Russian response & token preserved', async () => {
    const res = await router.routeQuery('Сколько стоит 30/70?', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'product_price');
    assert.strictEqual(res.language, 'ru');
    assert.strictEqual(res.leadSignals?.productNeed, '30/70');
    assert.ok(res.replyText.includes('30/70'));
    assert.ok(res.replyText.includes('Цена'));
    assertNoMojibake(res.replyText, 'Сколько стоит reply');
  });

  it('7. Query "30/70 bormi?" -> product_stock, uz-Latn, token preserved', async () => {
    const res = await router.routeQuery('30/70 bormi?', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'product_stock');
    assert.strictEqual(res.language, 'uz');
    assert.strictEqual(res.leadSignals?.productNeed, '30/70');
    assert.ok(res.replyText.includes('30/70'));
    assert.ok(res.replyText.includes('omborda mavjud'));
    assertNoMojibake(res.replyText, '30/70 bormi reply');
  });

  it('8. Query "30/70 борми?" -> product_stock, uz-Cyrl, Cyrillic response & token preserved', async () => {
    const res = await router.routeQuery('30/70 борми?', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'product_stock');
    assert.strictEqual(res.leadSignals?.productNeed, '30/70');
    assert.ok(res.replyText.includes('30/70'));
    assertNoMojibake(res.replyText, '30/70 борми reply');
  });

  it('9. Query "Есть ли 30/70 в наличии?" -> product_stock, ru, Russian response & token preserved', async () => {
    const res = await router.routeQuery('Есть ли 30/70 в наличии?', mockContext);
    assert.ok(res);
    assert.strictEqual(res.intent, 'product_stock');
    assert.strictEqual(res.language, 'ru');
    assert.strictEqual(res.leadSignals?.productNeed, '30/70');
    assert.ok(res.replyText.includes('30/70'));
    assert.ok(res.replyText.includes('в наличии'));
    assertNoMojibake(res.replyText, 'Есть ли 30/70 reply');
  });

  it('10. Query "Menejer bilan gaplashmoqchiman" -> CUSTOMER_REQUESTED_MANAGER, uz-Latn, needsHandoff', async () => {
    const res = await router.routeQuery('Menejer bilan gaplashmoqchiman', mockContext);
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true);
    assert.strictEqual(res.language, 'uz');
    assert.ok(res.replyText.includes('menejerga uzatildi'));
    assertNoMojibake(res.replyText, 'Menejer Latin reply');
  });

  it('11. Query "Менежер билан гаплашмоқчиман" -> CUSTOMER_REQUESTED_MANAGER, uz-Cyrl, needsHandoff & Cyrillic response', async () => {
    const res = await router.routeQuery('Менежер билан гаплашмоқчиман', mockContext);
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true);
    assert.strictEqual(res.language, 'uz-Cyrl');
    assert.ok(res.replyText.includes('менежерга узатилди'));
    assertNoMojibake(res.replyText, 'Менежер Cyrillic reply');
  });

  it('12. Query "Хочу поговорить с менеджером" -> CUSTOMER_REQUESTED_MANAGER, ru, needsHandoff & Russian response', async () => {
    const res = await router.routeQuery('Хочу поговорить с менеджером', mockContext);
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true);
    assert.strictEqual(res.language, 'ru');
    assert.ok(res.replyText.includes('передан менеджеру'));
    assertNoMojibake(res.replyText, 'Менеджер Russian reply');
  });

  // ── 2. Product Token Preservation ────────────────────────────────────────

  it('13. Product token 75D/36 is extracted and preserved intact', () => {
    const text = '75D/36 narxi nech pul?';
    const extracted = extractEntities(text).product;
    assert.strictEqual(extracted, '75D/36');
  });

  it('14. Product token 2070K is extracted and preserved intact', () => {
    const text = '2070K bormi omborda?';
    const extracted = extractEntities(text).product;
    assert.strictEqual(extracted, '2070K');
  });

  it('15. Product token 40/1 is extracted and preserved intact', () => {
    const text = '40/1 qora naylon narxi';
    const extracted = extractEntities(text).product;
    assert.strictEqual(extracted, '40/1');
  });

  it('16. Product token 70/1 is extracted and preserved intact', () => {
    const text = '70/1 oq ip bormi';
    const extracted = extractEntities(text).product;
    assert.strictEqual(extracted, '70/1');
  });

  // ── 3. Dataset Parsing & Mojibake Audit ───────────────────────────────────

  const datasetFiles = [
    'packages/ai-engine/src/templates/dataset/03_TEMPLATE_QA_FINAL.json',
    'packages/ai-engine/src/templates/dataset/04_CUSTOMER_LANGUAGE_DICTIONARY.json',
    'packages/ai-engine/src/templates/dataset/09_TEMPLATE_ROUTER_COMPACT.json',
  ];

  it('17. Dataset JSON files parse validly without corruption', () => {
    for (const relPath of datasetFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      assert.ok(fs.existsSync(absPath), `Dataset file exists: ${relPath}`);
      const raw = fs.readFileSync(absPath, 'utf8');
      const parsed = JSON.parse(raw);
      assert.ok(parsed, `Parsed JSON successfully: ${relPath}`);
    }
  });

  it('18. Datasets contain 0 mojibake markers and preserve real customer typos', () => {
    for (const relPath of datasetFiles) {
      const absPath = path.resolve(process.cwd(), relPath);
      const raw = fs.readFileSync(absPath, 'utf8');
      for (const marker of MOJIBAKE_MARKERS) {
        assert.ok(!raw.includes(marker), `Dataset ${relPath} contains mojibake marker "${marker}"`);
      }
    }

    // Verify real customer typos/dialects are preserved
    const dictPath = path.resolve(process.cwd(), 'packages/ai-engine/src/templates/dataset/04_CUSTOMER_LANGUAGE_DICTIONARY.json');
    const dictRaw = fs.readFileSync(dictPath, 'utf8');
    assert.ok(dictRaw.includes('necpul'), 'Dictionary preserves customer typo "necpul"');
    assert.ok(dictRaw.includes('bomi'), 'Dictionary preserves customer typo "bomi"');
    assert.ok(dictRaw.includes('obrazets'), 'Dictionary preserves customer term "obrazets"');
  });
});
