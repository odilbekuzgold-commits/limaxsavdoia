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

  it('routes urgent same-day delivery inquiries to deliveryToday with manager handoff', async () => {
    const todayDelivery = await router.routeQuery('bugun yetkazib berolasizlarmi', context);
    assert.strictEqual(todayDelivery?.replyText, MASTER_RESPONSES_UZ.deliveryToday);
    assert.strictEqual(todayDelivery?.needsHandoff, true);
    assert.strictEqual(todayDelivery?.handoffReason, 'DELIVERY_TIMING_REQUEST');

    const todayPossible = await router.routeQuery('bugun iloji bormi', context);
    assert.strictEqual(todayPossible?.replyText, MASTER_RESPONSES_UZ.deliveryToday);
    assert.strictEqual(todayPossible?.needsHandoff, true);
    assert.strictEqual(todayPossible?.handoffReason, 'DELIVERY_TIMING_REQUEST');

    const canWeToday = await router.routeQuery('bugunga ulguradimi', context);
    assert.strictEqual(canWeToday?.replyText, MASTER_RESPONSES_UZ.deliveryToday);
    assert.strictEqual(canWeToday?.needsHandoff, true);
  });

  it('prevents repetitive canned replies when delivery, payment, or location was already explained', async () => {
    const deliveryAgain = await router.routeQuery('yetkazib berish bormi', {
      ...context,
      conversationHistory: [
        { role: 'user', content: 'yetkazib berish bormi' },
        { role: 'assistant', content: MASTER_RESPONSES_UZ.deliveryTerms },
      ],
    });
    assert.strictEqual(deliveryAgain?.replyText, MASTER_RESPONSES_UZ.deliveryFollowUp);

    const paymentAgain = await router.routeQuery('to‘lov shartlari qanday?', {
      ...context,
      conversationHistory: [
        { role: 'user', content: 'to‘lov qanday bo‘ladi' },
        { role: 'assistant', content: MASTER_RESPONSES_UZ.paymentTerms },
      ],
    });
    assert.strictEqual(paymentAgain?.replyText, MASTER_RESPONSES_UZ.paymentFollowUp);

    const locationAgain = await router.routeQuery('manzil qayerda?', {
      ...context,
      conversationHistory: [
        { role: 'user', content: 'qayerda joylashgan' },
        { role: 'assistant', content: MASTER_RESPONSES_UZ.locationAngren },
      ],
    });
    assert.strictEqual(locationAgain?.replyText, MASTER_RESPONSES_UZ.locationFollowUp);
  });

  it('handles invoice, ready packaging, and destination requests across Cyrillic and Latin', async () => {
    const cyrillicInvoice = await router.routeQuery('Лимах фактура беришсин Пул ташаб турамиз', {
      preferredLanguage: 'uz-Cyrl',
    });
    assert.strictEqual(cyrillicInvoice?.replyText, MASTER_RESPONSES_UZ.invoiceTerms);
    assert.strictEqual(cyrillicInvoice?.needsHandoff, true);
    assert.strictEqual(cyrillicInvoice?.handoffReason, 'INVOICE_REQUEST');

    const cyrillicPackaging = await router.routeQuery('Каробка борми бугунга тайёри', {
      preferredLanguage: 'uz-Cyrl',
    });
    assert.strictEqual(cyrillicPackaging?.replyText, MASTER_RESPONSES_UZ.readyBoxesInStock);

    const latinPackaging = await router.routeQuery('karobka bormi bugunga tayyori', context);
    assert.strictEqual(latinPackaging?.replyText, MASTER_RESPONSES_UZ.readyBoxesInStock);

    const norinDestination = await router.routeQuery('noringa', {
      ...context,
      conversationHistory: [
        { role: 'assistant', content: MASTER_RESPONSES_UZ.deliveryFollowUp },
      ],
    });
    assert.strictEqual(norinDestination?.replyText, MASTER_RESPONSES_UZ.deliveryDestinationAck('Norin'));
    assert.strictEqual(norinDestination?.needsHandoff, true);
  });
});


