import type { AIContext, AIStructuredResult, SupportedLanguage } from '@limax/shared';
import { detectLanguage } from '../index.js';
import type { IAIProviderAdapter, ProviderRequestOptions, ProviderRawResponse } from './types.js';
import { MASTER_RESPONSES_UZ } from '../templates/master-responses.js';

// ──────────────────────────────────────────────
// Mojibake guard: verify no corrupted chars in strings
// ──────────────────────────────────────────────
export const MOJIBAKE_RE = /[\u00C3\u00C2\u00D0\u00D1\u00E2\u008E\u00CA\u00BC]/u;

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
// Priority: Security > Complaint > Manager > Order > Sample > Catalog
//   > Product+Stock combined > Price > Stock-only > Product-only > Greeting
// NOTE: "mahsulotlar bormi" must resolve as PRODUCT_INQUIRY, not STOCK
// ──────────────────────────────────────────────
function detectIntent(lower: string): MockIntent {
  // 1. Security injection
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

  // 2. High-priority complaint/order/sample/manager
  if (/(brak|tuklik|qaytarish|vozvrat|sifatsiz|nosoz)/i.test(lower)) return 'COMPLAINT';
  if (/(menejer|менежер|manager bilan|manager kerak)/i.test(lower)) return 'MANAGER_REQUEST';
  if (/(zakaz|buyurtma|тонна|tonna|kg kerak|kilogram kerak)/i.test(lower)) return 'ORDER';
  if (/(namuna|образец|obrazets|obrazes)/i.test(lower)) return 'SAMPLE';
  if (/(katalog|rasm|catalog|фото|photo)/i.test(lower)) return 'CATALOG';

  // 3. Price intent (before stock/product to catch "narx" combos)
  if (/(narx|narxi|narxlar|нарх|nechpul|necpul|qanchadan|qancha|price|cost)/i.test(lower)) return 'PRICE';

  // 4. Product word present — PRODUCT_INQUIRY wins even if "bormi" also present
  //    "mahsulotlar bormi" = asking about product existence → PRODUCT_INQUIRY
  if (/(mahsulot|mahsulotlar|iplar|polyester|poliyester|dty|fdy|poy|sdy|yarn)/i.test(lower)) {
    return 'PRODUCT_INQUIRY';
  }

  // 5. Pure stock query (no product context word)
  if (/(bormi|mavjudmi|qoldiq|sklad|ombor|склад|stok|stock)/i.test(lower)) return 'STOCK';

  // 6. General product inquiry ("ip kerak")
  if (/\bip\b|materia/i.test(lower)) return 'PRODUCT_INQUIRY';

  // 7. Greeting
  if (/(salom|assalomu alaykum|привет|hello|\bhi\b|хай)/i.test(lower)) return 'GREETING';

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
  const isCyrl = lang === 'uz-Cyrl';

  // Extract product token from message if present
  const tokenMatch = lower.match(PRODUCT_TOKEN_RE);
  const productToken = tokenMatch ? tokenMatch[0].toUpperCase() : null;

  switch (intent) {
    // ── Security ──────────────────────────────
    case 'PROMPT_INJECTION':
      return {
        replyText: isRu
          ? 'Izvinite, ya ne mogu raskryvat vnutrennie dannye sistemy.'
          : isCyrl
          ? 'Kechirasiz, xavfsizlik va ichki tizim malumotlarini ochinqlay olmayman.'
          : 'Kechirasiz, xavfsizlik va ichki tizim malumotlarini ochiqlay olmayman.',
        intent: 'security_blocked',
        confidence: 0.1,
        needsHandoff: true,
        handoffReason: 'PROMPT_INJECTION_DETECTED',
        leadSignals: {},
      };

    // ── Greeting ──────────────────────────────
    case 'GREETING':
      if (!isNewConversation) {
        // Active conversation: short reply, no re-welcome
        return {
          replyText: isRu
            ? 'Chem mogu pomoch?'
            : isCyrl
            ? 'Qanday yordam bera olaman?'
            : MASTER_RESPONSES_UZ.greetingOngoing,
          intent: 'general_inquiry',
          confidence: 0.9,
          needsHandoff: false,
          leadSignals: {},
        };
      }
      return {
        replyText: isRu
          ? 'Zdravstvuyte! Pomogayu s informaciyey o poliefirnoy pryazhe LImax. Po kakomu produktu nuzhna informaciya?'
          : isCyrl
          ? "Assalomu alaykum! LImax ip mahsulotlari bo'yicha yordam beraman. Qaysi mahsulot bo'yicha ma'lumot kerak?"
          : MASTER_RESPONSES_UZ.greetingNew,
        intent: 'general_inquiry',
        confidence: 0.95,
        needsHandoff: false,
        leadSignals: {},
      };

    // ── Product Inquiry ───────────────────────
    case 'PRODUCT_INQUIRY': {
      const products = context.availableProducts || [];
      if (productToken) {
        // Code already known — confirm and ask for params, do NOT re-ask product type
        return {
          replyText: isRu
            ? `Ponyal, nuzhna nit ${productToken}. Utochnite parametry ili kolichestvo?`
            : isCyrl
            ? `Tushundim, ${productToken} kerak. Miqdor yoki parametr aytasiz?`
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
          .map((p) => `* ${p.name}`)
          .join('\n');
        return {
          replyText: isRu
            ? `Dostupnye produkty:\n${list}\n\nKakoy imenno nuzhen?`
            : isCyrl
            ? `Mavjud mahsulotlar:\n${list}\n\nQaysi biri kerak?`
            : `Mavjud mahsulotlar:\n${list}\n\nQaysi biri kerak?`,
          intent: 'product_stock',
          confidence: 0.9,
          needsHandoff: false,
          leadSignals: {},
        };
      }
      return {
        replyText: isRu
          ? 'Kakoye tip niti nuzhen?'
          : isCyrl
          ? 'Qaysi turdagi ip kerak edi?'
          : 'Qaysi turdagi ip kerak edi?',
        intent: 'product_stock',
        confidence: 0.85,
        needsHandoff: false,
        leadSignals: {},
      };
    }

    // ── Price ─────────────────────────────────
    case 'PRICE': {
      // Never invent price — ask for product/code or send to manager if code known
      if (productToken) {
        return {
          replyText: isRu
            ? `Tsena ${productToken} utochnyaetsya. Menedzher svyazhetsya s vami.`
            : isCyrl
            ? `${productToken} narxi tasdiqlanmagan. Menejer siz bilan bog'lanadi.`
            : MASTER_RESPONSES_UZ.priceClarifyPaymentType(productToken),
          intent: 'product_price',
          confidence: 0.7,
          needsHandoff: true,
          handoffReason: 'PRICE_UNCONFIRMED',
          leadSignals: { productNeed: productToken },
        };
      }
      return {
        replyText: isRu
          ? 'Ukazhite kod ili tip produkta dlya utochneniya tseny.'
          : isCyrl
          ? 'Narxni bilish uchun mahsulot kodi yoki turini ayting.'
          : 'Narxni bilish uchun mahsulot kodi yoki turini ayting.',
        intent: 'product_price',
        confidence: 0.85,
        needsHandoff: false,
        leadSignals: {},
      };
    }

    // ── Stock ─────────────────────────────────
    case 'STOCK': {
      const products = context.availableProducts || [];
      if (productToken) {
        const matched = products.find(
          (p) => p.name.toLowerCase().includes(productToken.toLowerCase()) && p.active
        );
        if (matched) {
          const stockText =
            matched.stockStatus === 'in_stock'
              ? (isRu ? 'est v nalichii' : 'mavjud')
              : matched.stockStatus === 'out_of_stock'
              ? (isRu ? 'net v nalichii' : 'mavjud emas')
              : (isRu ? 'utochnyaetsya' : 'UNKNOWN');
          return {
            replyText: `${matched.name} — ${stockText}.`,
            intent: 'product_stock',
            confidence: 0.9,
            needsHandoff: false,
            leadSignals: { productNeed: matched.name },
          };
        }
      }
      // Master rule: ask which yarn; active catalog items are treated as available.
      return {
        replyText: isRu
          ? 'Nalichie: UNKNOWN. Kakoye produkt interesует?'
          : isCyrl
          ? 'Qoldiq: UNKNOWN. Qaysi mahsulot kerak edi?'
          : MASTER_RESPONSES_UZ.unspecifiedProductClarify,
        intent: 'product_stock',
        confidence: 0.75,
        needsHandoff: false,
        leadSignals: {},
      };
    }

    // ── Sample ────────────────────────────────
    case 'SAMPLE':
      return {
        replyText: isRu
          ? 'Po voprosu obraztsa svyazhem vas s menedzherom.'
          : isCyrl
          ? "Namuna bo'yicha menejer bilan bog'laymiz."
          : MASTER_RESPONSES_UZ.sampleFree,
        intent: 'sample_request',
        confidence: 0.85,
        needsHandoff: true,
        handoffReason: 'SAMPLE_REQUEST',
        leadSignals: {},
      };

    // ── Catalog ───────────────────────────────
    case 'CATALOG':
      return {
        replyText: isRu
          ? 'Katalog otpravim cherez menedzhera. Kakoye produkt interesuet?'
          : isCyrl
          ? 'Katalog menejer orqali yuboriladi. Qaysi mahsulot qiziqtiradi?'
          : MASTER_RESPONSES_UZ.catalogHandoff,
        intent: 'general_inquiry',
        confidence: 0.8,
        needsHandoff: false,
        leadSignals: {},
      };

    // ── Manager ───────────────────────────────
    case 'MANAGER_REQUEST':
      return {
        replyText: isRu
          ? 'Peredayu vas menedzheru. Pozhaluysta, ozhidayte.'
          : isCyrl
          ? 'Menejerga ulaymiz. Kutib turing.'
          : MASTER_RESPONSES_UZ.managerHandoff,
        intent: 'general_inquiry',
        confidence: 0.95,
        needsHandoff: true,
        handoffReason: 'CUSTOMER_REQUESTED_MANAGER',
        leadSignals: {},
      };

    // ── Complaint ─────────────────────────────
    case 'COMPLAINT':
      return {
        replyText: isRu
          ? 'Izvinite za neudobstvo. Mozhete otpravit foto ili video?'
          : isCyrl
          ? 'Noqulaylik uchun uzr. Rasm yoki video yuborasizmi?'
          : MASTER_RESPONSES_UZ.complaint,
        intent: 'complaint',
        confidence: 0.95,
        needsHandoff: true,
        handoffReason: 'COMPLAINT_HIGH_PRIORITY',
        leadSignals: {},
      };

    // ── Order ─────────────────────────────────
    case 'ORDER': {
      const qty = lower.match(/(\d+)\s*(tonna|kg|kilogram|тонн|кг)/i)?.[0] || null;
      return {
        replyText: isRu
          ? `Ponyal, nuzhen zakaz${qty ? ` (${qty})` : ''}. Ukazhite produkt i parametry — peredам menedzheru.`
          : isCyrl
          ? `Tushundim, buyurtma${qty ? ` (${qty})` : ''} kerak. Mahsulot va parametrlarni ayting — menejerga ulaymiz.`
          : `Tushundim, buyurtma${qty ? ` (${qty})` : ''} kerak. Mahsulot va parametrlarni ayting — menejerga ulaymiz.`,
        intent: 'order',
        confidence: 0.9,
        needsHandoff: true,
        handoffReason: 'ORDER_REQUEST',
        leadSignals: qty ? { quantity: qty } : {},
      };
    }

    // ── Unknown ───────────────────────────────
    case 'UNKNOWN':
    default:
      return {
        replyText: isRu
          ? 'Po kakomu produktu nuzhna informaciya?'
          : isCyrl
          ? "Qaysi mahsulot bo'yicha ma'lumot kerak edi?"
          : "Qaysi mahsulot bo'yicha ma'lumot kerak edi?",
        intent: 'general_inquiry',
        confidence: 0.7,
        needsHandoff: false,
        leadSignals: {},
      };
  }
}

// ──────────────────────────────────────────────
// Mock AI Provider Adapter — intent-aware, no mojibake
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

    // Determine if this is a new conversation using explicit service-layer signal first,
    // falling back to history length as a safety net
    const isNewConversation =
      context.isNewConversation === true ||
      (!context.conversationHistory || context.conversationHistory.length === 0);

    const intent = detectIntent(lower);
    const { replyText, ...rest } = buildReply(intent, lower, lang, context, isNewConversation);

    // Runtime safety: ensure no mojibake markers leaked into response
    if (MOJIBAKE_RE.test(replyText)) {
      throw new Error(`ENCODING_ERROR: mojibake detected in mock reply: ${replyText.slice(0, 60)}`);
    }

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
