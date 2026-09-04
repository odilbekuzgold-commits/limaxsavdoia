import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TemplateQARouter } from '../../packages/ai-engine/dist/index.js';
import { createRepositories } from '../../packages/database/dist/index.js';

describe('Stage 17.4: Google Sheets Master Runtime Integration Unit Tests', () => {
  const router = new TemplateQARouter();

  const mockProducts = [
    {
      id: 'prod-40100k-black',
      name: '40100K BLACK',
      code: '40100K-BLACK',
      category: 'Poliester',
      color: 'BLACK',
      count: '40100K',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'prod-40100k-white',
      name: '40100K WHITE',
      code: '40100K-WHITE',
      category: 'Poliester',
      color: 'WHITE',
      count: '40100K',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'prod-300d-black',
      name: '300D/96 BLACK',
      code: '300D-BLACK',
      category: 'Poliester',
      color: 'BLACK',
      count: '300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'prod-300d-white',
      name: '300D/96 WHITE',
      code: '300D-WHITE',
      category: 'Poliester',
      color: 'WHITE',
      count: '300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'prod-w300d-black',
      name: 'W300D/96 BLACK',
      code: 'W300D-BLACK',
      category: 'Poliester',
      color: 'BLACK',
      count: 'W300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'prod-w300d-white',
      name: 'W300D/96 WHITE',
      code: 'W300D-WHITE',
      category: 'Poliester',
      color: 'WHITE',
      count: 'W300D/96',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'prod-2075k-mix',
      name: '2075K MIX COLOR',
      code: '2075K-MIX',
      category: 'Mexanicheskiy',
      color: 'MIX COLOR',
      count: '2075K',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockContext = {
    preferredLanguage: 'uz' as const,
    availableProducts: mockProducts as any,
  };

  const setupMemoryReposWithPrices = async () => {
    const repos = createRepositories('memory');
    for (const p of mockProducts) {
      await repos.products.create(p as any);
    }
    // 40100K BLACK
    await repos.productPrices.create({
      productId: 'prod-40100k-black',
      paymentType: 'BANK_TRANSFER',
      price: 2.39,
      currency: 'USD',
      unit: 'kg',
      active: true,
      validFrom: new Date(),
      sourceSystem: 'GOOGLE_SHEETS',
    });
    await repos.productPrices.create({
      productId: 'prod-40100k-black',
      paymentType: 'CASH',
      price: 2.50,
      currency: 'USD',
      unit: 'kg',
      active: true,
      validFrom: new Date(),
      sourceSystem: 'GOOGLE_SHEETS',
    });

    // 40100K WHITE
    await repos.productPrices.create({
      productId: 'prod-40100k-white',
      paymentType: 'BANK_TRANSFER',
      price: 2.39,
      currency: 'USD',
      unit: 'kg',
      active: true,
      validFrom: new Date(),
      sourceSystem: 'GOOGLE_SHEETS',
    });
    await repos.productPrices.create({
      productId: 'prod-40100k-white',
      paymentType: 'CASH',
      price: 2.50,
      currency: 'USD',
      unit: 'kg',
      active: true,
      validFrom: new Date(),
      sourceSystem: 'GOOGLE_SHEETS',
    });

    // 300D/96 BLACK & WHITE
    await repos.productPrices.create({
      productId: 'prod-300d-black',
      paymentType: 'CASH',
      price: 2.15,
      currency: 'USD',
      unit: 'kg',
      active: true,
      validFrom: new Date(),
      sourceSystem: 'GOOGLE_SHEETS',
    });
    await repos.productPrices.create({
      productId: 'prod-300d-white',
      paymentType: 'CASH',
      price: 2.10,
      currency: 'USD',
      unit: 'kg',
      active: true,
      validFrom: new Date(),
      sourceSystem: 'GOOGLE_SHEETS',
    });

    return repos;
  };

  it('1. "40100K BLACK narxi qancha?" -> avval to‘lov turini aniqlashtiradi', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('40100K BLACK narxi qancha?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('naqd') && /o['‘’]?tkazish|perechislenie/i.test(res.replyText));
    assert.ok(!res.replyText.includes('2.39') && !res.replyText.includes('2.50'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('2. "40100K BLACK naqd narxi qancha?" -> Faqat 2.50 USD/kg', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('40100K BLACK naqd narxi qancha?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('2.50') || res.replyText.includes('2.5'));
    assert.ok(!res.replyText.includes('2.39'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('3. "300lik poliester kerak" -> "300D/96 yoki W300D/96 kerakmi?"', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('300lik poliester kerak', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('300D/96') && res.replyText.includes('W300D/96'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('4. "300D/96 narxi qancha?" -> Rangni aniqlashtiradi', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('300D/96 narxi qancha?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('BLACK') && res.replyText.includes('WHITE'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('5. "2075K MIX COLOR minimal qancha?" -> 100 kg MOQ', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('2075K MIX COLOR minimal qancha?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('100 kg') || res.replyText.includes('100'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('6. "40100K BLACK minimal qancha?" -> Standart mahsulotda MOQ yo‘q', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('40100K BLACK minimal qancha?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('yo‘q') || res.replyText.includes('yoq') || res.replyText.includes('cheklanmagan'));
    assert.ok(!res.replyText.includes('1 kg') && !res.replyText.includes('500 kg'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('7. "300D/96 BLACK bormi?" -> Mavjud deb javob beradi, qoldiq sonini aytmaydi', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('300D/96 BLACK bormi?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('bor'));
    assert.ok(!res.replyText.includes('dona') && !res.replyText.includes('kg mavjud') && !res.replyText.includes('mavjud emas'));
    assert.strictEqual(res.needsHandoff, false);
  });

  it('8. Source fidelity: 40100K va 300D/96 tokenlari aynan saqlanadi', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('40100K BLACK narxi qancha?', mockContext, { repos });
    assert.ok(res);
    assert.ok(res.replyText.includes('40100K'));
    assert.ok(!res.replyText.includes('40/100K'));
  });

  it('9. "Menejer kerak" -> Handoff talab qilinadi va ehtiyoj belgilanadi', async () => {
    const repos = await setupMemoryReposWithPrices();
    const res = await router.routeQuery('Menejer bilan gaplashmoqchiman', mockContext, { repos });
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true);
  });

  it('10. Narx topilmaganda narx o‘ylab topilmaydi', async () => {
    const repos = await setupMemoryReposWithPrices();
    // 2075K MIX COLOR has no price row in setupMemoryReposWithPrices
    const res = await router.routeQuery('2075K MIX COLOR naqd narxi qancha?', mockContext, { repos });
    assert.ok(res);
    assert.strictEqual(res.needsHandoff, true);
    assert.strictEqual(res.replyText, 'Hozir aniqlashtirib beraman!');
  });

  it('11. Biznes qoidalari: Bepul namuna va 2 yil kafolat', async () => {
    const resSample = await router.routeQuery('Namunalar bormi?', mockContext);
    assert.ok(resSample);
    assert.ok(resSample.replyText.includes('namunalar bepul'));

    const resWarranty = await router.routeQuery('Kafolat bormi?', mockContext);
    assert.ok(resWarranty);
    assert.ok(resWarranty.replyText.includes('2 yil kafolat'));
  });
});
