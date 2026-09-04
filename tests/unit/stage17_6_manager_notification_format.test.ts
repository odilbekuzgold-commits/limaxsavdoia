import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatManagerHandoffNotification } from '../../apps/api/src/modules/telegram/service.ts';

describe('Stage 17.6: manager handoff notification format', () => {
  it('shows the available customer, request and lead details', () => {
    const message = formatManagerHandoffNotification({
      customerName: 'Odilbek Ansoriy',
      promptText: 'white',
      telegramId: '722615383',
      username: 'username',
      phone: '+998 90 123 45 67',
      companyName: 'Example Textile',
      location: 'Toshkent',
      language: 'uz-Latn',
      product: '40100K',
      color: 'WHITE',
      quantity: '500 kg',
      deadline: '20-avgust',
      leadTemperature: 'WARM',
      handoffReason: 'FALLBACK_FAILED',
      createdAt: new Date('2026-08-19T12:17:50.978Z'),
    });

    assert.match(message, /Yangi handoff/);
    assert.match(message, /Odilbek Ansoriy/);
    assert.match(message, /Telefon: \+998 90 123 45 67/);
    assert.match(message, /Username: @username/);
    assert.match(message, /Telegram ID: 722615383/);
    assert.match(message, /Kompaniya: Example Textile/);
    assert.match(message, /Hudud: Toshkent/);
    assert.match(message, /Kanal: Telegram/);
    assert.match(message, /Til: Uzbek/);
    assert.match(message, /Qiziqqan mahsulot: 40100K/);
    assert.match(message, /Rang: WHITE/);
    assert.match(message, /Miqdor: 500 kg/);
    assert.match(message, /Qachonga kerak: 20-avgust/);
    assert.match(message, /Sabab: Bot javob bera olmadi/);
    assert.match(message, /Oxirgi xabar: “white”/);
    assert.match(message, /Lead: WARM/);
    assert.match(message, /Ustuvorlik: O‘rta/);
    assert.match(message, /Vaqt: 2026-08-19 17:17/);
    assert.doesNotMatch(message, /FALLBACK_FAILED/);
    assert.doesNotMatch(message, /Conversation ID/);
  });

  it('omits optional fields when their values are unavailable', () => {
    const message = formatManagerHandoffNotification({
      customerName: 'Mijoz',
      promptText: 'Menejer kerak',
      telegramId: '123',
      language: 'uz-Latn',
      handoffReason: 'CUSTOMER_REQUESTED_MANAGER',
    });

    assert.doesNotMatch(message, /Telefon:/);
    assert.doesNotMatch(message, /Username:/);
    assert.doesNotMatch(message, /Kompaniya:/);
    assert.doesNotMatch(message, /Hudud:/);
    assert.doesNotMatch(message, /Qiziqqan mahsulot:/);
    assert.doesNotMatch(message, /Rang:/);
    assert.doesNotMatch(message, /Miqdor:/);
    assert.doesNotMatch(message, /Qachonga kerak:/);
  });

  it('marks complaints as high priority', () => {
    const message = formatManagerHandoffNotification({
      customerName: 'Mijoz',
      promptText: 'Mahsulot sifati bo‘yicha muammo bor',
      handoffReason: 'TEMPLATE_HANDOFF_COMPLAINT',
      intent: 'complaint',
    });

    assert.match(message, /Sabab: Mijoz shikoyat qildi/);
    assert.match(message, /Ustuvorlik: Yuqori/);
  });
});
