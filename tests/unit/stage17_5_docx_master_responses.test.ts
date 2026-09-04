import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MASTER_RESPONSES_UZ,
  TemplateQARouter,
  getTemplates,
} from '../../packages/ai-engine/dist/index.js';

describe('Stage 17.5: DOCX master responses runtime', () => {
  const router = new TemplateQARouter();
  const context = { preferredLanguage: 'uz' as const, isNewConversation: true };

  it('uses the approved greeting, thanks and farewell replies', async () => {
    assert.strictEqual((await router.routeQuery('salom', context))?.replyText, MASTER_RESPONSES_UZ.greetingNew);
    assert.strictEqual((await router.routeQuery('rahmat', context))?.replyText, MASTER_RESPONSES_UZ.thanks);
    assert.strictEqual((await router.routeQuery('xayr', context))?.replyText, MASTER_RESPONSES_UZ.goodbye);
  });

  it('uses the approved identity reply without a handoff', async () => {
    const result = await router.routeQuery('Sen AI misan?', context);
    assert.strictEqual(result?.replyText, MASTER_RESPONSES_UZ.identity);
    assert.strictEqual(result?.needsHandoff, false);
  });

  it('manager request uses the approved acknowledgement and real handoff flag', async () => {
    const result = await router.routeQuery('Menejer bilan gaplashmoqchiman', context);
    assert.strictEqual(result?.replyText, MASTER_RESPONSES_UZ.managerHandoff);
    assert.strictEqual(result?.needsHandoff, true);
    assert.strictEqual(getTemplates('uz').managerHandoff(), MASTER_RESPONSES_UZ.managerHandoff);
  });

  it('catalog and complaint requests require manager handoff', async () => {
    const catalog = await router.routeQuery('Katalog bormi?', context);
    const complaint = await router.routeQuery('Ip uzilyapti, brak chiqdi', context);
    assert.strictEqual(catalog?.replyText, MASTER_RESPONSES_UZ.catalogHandoff);
    assert.strictEqual(catalog?.needsHandoff, true);
    assert.strictEqual(complaint?.replyText, MASTER_RESPONSES_UZ.complaint);
    assert.strictEqual(complaint?.needsHandoff, true);
  });

  it('returns approved payment, logistics and quality facts', async () => {
    assert.strictEqual((await router.routeQuery('To‘lov shartlari qanday?', context))?.replyText, MASTER_RESPONSES_UZ.paymentTerms);
    assert.strictEqual((await router.routeQuery('Ish vaqti qachon?', context))?.replyText, MASTER_RESPONSES_UZ.workingHours);
    assert.strictEqual((await router.routeQuery('Manzil qayerda?', context))?.replyText, MASTER_RESPONSES_UZ.locationAngren);
    assert.strictEqual((await router.routeQuery('Sertifikat bormi?', context))?.replyText, MASTER_RESPONSES_UZ.certificates);
    assert.strictEqual((await router.routeQuery('Mahsulot tarkibi qanday?', context))?.replyText, MASTER_RESPONSES_UZ.composition);
  });

  it('retains product context when customer answers only "naqd"', async () => {
    const result = await router.routeQuery('naqd', {
      ...context,
      conversationHistory: [{ role: 'user', content: '40100K narxi qancha?' }],
      availableProducts: [{
        id: 'p1', name: '40100K BLACK', code: '40100K-BLACK', count: '40100K',
        category: 'Poliester', active: true, price: 2.5, currency: 'USD',
        createdAt: new Date(), updatedAt: new Date(),
      } as any],
    });
    assert.ok(result?.replyText.includes('40100K'));
    assert.ok(result?.replyText.includes('naqd'));
  });
});
