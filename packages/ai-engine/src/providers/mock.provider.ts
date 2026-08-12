import type { AIContext, AIStructuredResult, SupportedLanguage } from '@limax/shared';
import { detectLanguage } from '../index.js';
import type { IAIProviderAdapter, ProviderRequestOptions, ProviderRawResponse } from './types.js';

// ──────────────────────────────────────────────
// Intent types
// ──────────────────────────────────────────────
type MockIntent =
  | 'GREETING'
  | 'PRODUCT_INQUIRY'
  | 'PRICE'
  | 'STOCK'
  | 'SAMPLE'
  | 'CATALOG'
  | 'MANAGER_REQUEST'
  | 'COMPLAINT'
  | 'ORDER'
  | 'PROMPT_INJECTION'
  | 'UNKNOWN';

// ──────────────────────────────────────────────
// Product token regex — preserved exactly
// ──────────────────────────────────────────────
const PRODUCT_TOKEN_RE =
  /\b(30\/70|20\/70|15\/55|15\/75|20\/75|75D\/36|70D\/2|40D\/2|2070K|3070K|DTY|FDY|POY|SDY)\b/i;

// ──────────────────────────────────────────────
// Detect intent from message text
// ──────────────────────────────────────────────
function detectIntent(lower: string): MockIntent {
  // Security first
  if (
    lower.includes('system prompt') ||
    lower.includes('api key') ||
    lower.includes('oldingi qoidalarni unut') ||
    lower.includes('forget previous') ||
    lower.includes('ignore all rules') ||
    lower.includes('secret')
  ) {
    return 'PROMPT_INJECTION';
  }

  if (/(brak|tuklik|qaytarish|vozvrat|sifatsiz|nosoz)/i.test(lower)) return 'COMPLAINT';
  if (/(menejer|менежер|manager bilan|manager kerak)/i.test(lower)) return 'MANAGER_REQUEST';
  if (/(zakaz|buyurtma|тонна|tonna|kg kerak|kilogram kerak)/i.test(lower)) return 'ORDER';
  if (/(namuna|образец|obrazets|obrazes)/i.test(lower)) return 'SAMPLE';
  if (/(katalog|rasm|catalog|фото|photo)/i.test(lower)) return 'CATALOG';
  if (/(narx|narxi|narxlar|нарх|nechpul|necpul|qanchadan|qancha|price|cost)/i.test(lower)) return 'PRICE';
  if (/(bormi|mavjudmi|qoldiq|sklad|ombor|склад|stok|stock)/i.test(lower)) return 'STOCK';
  if (/(mahsulot|ip|polyester|poliyester|dty|fdy|poy|sdy|yarn|materia|iplar)/i.test(lower)) return 'PRODUCT_INQUIRY';
  if (/(salom|assalomu alaykum|привет|hello|hi\b|хай)/i.test(lower)) return 'GREETING';

  return 'UNKNOWN';
}

// ──────────────────────────────────────────────
// Build reply text per intent, language & context
// ──────────────────────────────────────────────
function buildReply(
  intent: MockIntent,
  lower: string,
  lang: SupportedLanguage,
  context: AIContext,
  isNewConversation: boolean
): Pick<AIStructuredResult, 'replyText' | 'intent' | 'confidence' | 'needsHandoff' | 'handoffReason' | 'leadSignals'> {
  const isRu = lang === 'ru';

  // Extract product token from message if present
  const tokenMatch = lower.match(PRODUCT_TOKEN_RE);
  const productToken = tokenMatch ? tokenMatch[0].toUpperCase() : null;

  switch (intent) {
    case 'PROMPT_INJECTION':
      return {
        replyText: isRu
          ? 'Извините, я не могу раскрывать внутренние данные системы.'
          : 'Kechirasiz, xavfsizlik va ichki tizim maʼlumotlarini ochiqlay olmayman.',
        intent: 'security_blocked',
        confidence: 0.1,
        needsHandoff: true,
        handoffReason: 'PROMPT_INJECTION_DETECTED',
        leadSignals: {},
      };

    case 'GREETING':
      if (!isNewConversation) {
        // Active conversation: don't re-greet, ask what's needed
        return {
          replyText: isRu ? 'Чем могу помочь?' : 'Qanday yordam bera olaman?',
          intent: 'general_inquiry',
          confidence: 0.9,
          needsHandoff: false,
          leadSignals: {},
        };
      }
      return {
        replyText: isRu
          ? 'Здравствуйте! Я помогаю с информацией о полиэфирной пряже LImax. По какому продукту нужна информация?'
          : 'Assalomu alaykum! LImax ip mahsulotlari bo\'yicha yordam beraman. Qaysi mahsulot bo\'yicha ma\'lumot kerak?',
        intent: 'general_inquiry',
        confidence: 0.95,
        needsHandoff: false,
        leadSignals: {},
      };

    case 'PRODUCT_INQUIRY': {
      const products = context.availableProducts || [];
      if (productToken) {
        // Code already known — don't ask again
        return {
          replyText: isRu
            ? `Понял, нужна нить ${productToken}. Уточните параметры или количество?`
            : `Tushundim, ${productToken} kerak. Miqdor yoki parametr aytasiz?`,
          intent: 'product_stock',
          confidence: 0.9,
          needsHandoff: false,
          leadSignals: { productNeed: productToken },
        };
      }
      if (products.length > 0) {
        const list = products
          .filter((p) => p.active)
          .slice(0, 5)
          .map((p) => `• ${p.name}`)
          .join('\n');
        return {
          replyText: isRu
            ? `Доступные продукты:\n${list}\n\nКакой именно нужен?`
            : `Mavjud mahsulotlar:\n${list}\n\nQaysi biri kerak?`,
          intent: 'product_stock',
          confidence: 0.9,
          needsHandoff: false,
          leadSignals: {},
        };
      }
      return {
        replyText: isRu
          ? 'Какой тип нити нужен?'
          : 'Qaysi turdagi ip kerak edi?',
        intent: 'product_stock',
        confidence: 0.85,
        needsHandoff: false,
        leadSignals: {},
      };
    }

    case 'PRICE': {
      // Never invent price — ask for product/code
      if (productToken) {
        return {
          replyText: isRu
            ? `Цена ${productToken} уточняется. Менеджер свяжется с вами.`
            : `${productToken} narxi tasdiqlanmagan. Menejer siz bilan bog'lanadi.`,
          intent: 'product_price',
          confidence: 0.7,
          needsHandoff: true,
          handoffReason: 'PRICE_UNCONFIRMED',
          leadSignals: { productNeed: productToken },
        };
      }
      return {
        replyText: isRu
          ? 'Укажите код или тип продукта для уточнения цены.'
          : 'Narxni bilish uchun mahsulot kodi yoki turini ayting.',
        intent: 'product_price',
        confidence: 0.85,
        needsHandoff: false,
        leadSignals: {},
      };
    }

    case 'STOCK': {
      const products = context.availableProducts || [];
      if (productToken) {
        const matched = products.find(
          (p) => p.name.toLowerCase().includes(productToken.toLowerCase()) && p.active
        );
        if (matched) {
          const stockText =
            matched.stockStatus === 'in_stock'
              ? (isRu ? 'есть в наличии' : 'mavjud')
              : matched.stockStatus === 'out_of_stock'
              ? (isRu ? 'нет в наличии' : 'mavjud emas')
              : (isRu ? 'уточняется' : 'tasdiqlanmagan');
          return {
            replyText: isRu
              ? `${matched.name} — ${stockText}.`
              : `${matched.name} — ${stockText}.`,
            intent: 'product_stock',
            confidence: 0.9,
            needsHandoff: false,
            leadSignals: { productNeed: matched.name },
          };
        }
      }
      // Unknown stock — never claim available
      return {
        replyText: isRu
          ? 'Наличие уточняется. Какой продукт вас интересует?'
          : 'Hozirgi qoldiq tasdiqlanmagan. Qaysi mahsulot kerak edi?',
        intent: 'product_stock',
        confidence: 0.75,
        needsHandoff: false,
        leadSignals: {},
      };
    }

    case 'SAMPLE':
      return {
        replyText: isRu
          ? 'По вопросу образца свяжем вас с менеджером.'
          : 'Namuna bo\'yicha menejer bilan bog\'laymiz.',
        intent: 'sample_request',
        confidence: 0.85,
        needsHandoff: true,
        handoffReason: 'SAMPLE_REQUEST',
        leadSignals: {},
      };

    case 'CATALOG':
      return {
        replyText: isRu
          ? 'Каталог отправим через менеджера. Какой продукт интересует?'
          : 'Katalog menejer orqali yuboriladi. Qaysi mahsulot qiziqtiradi?',
        intent: 'general_inquiry',
        confidence: 0.8,
        needsHandoff: false,
        leadSignals: {},
      };

    case 'MANAGER_REQUEST':
      return {
        replyText: isRu
          ? 'Передаю вас менеджеру. Пожалуйста, ожидайте.'
          : 'Menejerga ulaymiz. Kutib turing.',
        intent: 'general_inquiry',
        confidence: 0.95,
        needsHandoff: true,
        handoffReason: 'CUSTOMER_REQUESTED_MANAGER',
        leadSignals: {},
      };

    case 'COMPLAINT':
      return {
        replyText: isRu
          ? 'Извините за неудобство. Можете отправить фото или видео?'
          : 'Noqulaylik uchun uzr. Rasm yoki video yuborasizmi?',
        intent: 'complaint',
        confidence: 0.95,
        needsHandoff: true,
        handoffReason: 'COMPLAINT_HIGH_PRIORITY',
        leadSignals: {},
      };

    case 'ORDER': {
      const qty = lower.match(/(\d+)\s*(tonna|kg|kilogram|тонн|кг)/i)?.[0] || null;
      return {
        replyText: isRu
          ? `Понял, нужен заказ${qty ? ` (${qty})` : ''}. Укажите продукт и параметры — передам менеджеру.`
          : `Tushundim, buyurtma${qty ? ` (${qty})` : ''} kerak. Mahsulot va parametrlarni ayting — menejerga ulaymiz.`,
        intent: 'order',
        confidence: 0.9,
        needsHandoff: true,
        handoffReason: 'ORDER_REQUEST',
        leadSignals: qty ? { quantity: qty } : {},
      };
    }

    case 'UNKNOWN':
    default:
      return {
        replyText: isRu
          ? 'По какому продукту нужна информация?'
          : 'Qaysi mahsulot bo\'yicha ma\'lumot kerak edi?',
        intent: 'general_inquiry',
        confidence: 0.7,
        needsHandoff: false,
        leadSignals: {},
      };
  }
}

// ──────────────────────────────────────────────
// Mock AI Provider Adapter — intent-aware
// ──────────────────────────────────────────────
export class MockAIProviderAdapter implements IAIProviderAdapter {
  readonly providerName = 'mock' as const;

  isConfigured(): boolean {
    return true;
  }

  async generateStructuredResponse(
    prompt: string,
    context: AIContext,
    _options?: ProviderRequestOptions
  ): Promise<ProviderRawResponse> {
    const startTime = Date.now();
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const lower = prompt.toLowerCase();

    // Determine if this is a new conversation (no prior history)
    const isNewConversation =
      !context.conversationHistory || context.conversationHistory.length === 0;

    const intent = detectIntent(lower);
    const { replyText, ...rest } = buildReply(intent, lower, lang, context, isNewConversation);

    const result: AIStructuredResult = {
      replyText,
      language: lang,
      usedKnowledgeIds: [],
      ...rest,
    };

    const latencyMs = Date.now() - startTime;
    return {
      result,
      inputTokens: 50,
      outputTokens: Math.ceil(replyText.length / 4),
      latencyMs,
    };
  }
}
