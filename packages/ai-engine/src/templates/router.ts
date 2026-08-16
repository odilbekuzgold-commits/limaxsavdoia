import type {
  AIContext,
  AIStructuredResult,
  Repositories,
} from '@limax/shared';
import { loadTemplateDataset } from './loader.js';
import { normalizeCustomerMessage } from './normalizer.js';
import { extractEntities } from './extractor.js';
import { sanitizePiiText } from './pii.js';
import { detectLanguage } from '../index.js';
import type {
  ExtractedEntities,
  TemplateMatchResult,
  TemplateQAItem,
} from './types.js';

export interface RouteOptions {
  repos?: Repositories;
  actionExecuted?: boolean;
}

export class TemplateQARouter {
  private dataset = loadTemplateDataset();

  /**
   * Main entry point: attempt to route prompt using Template Q&A dataset.
   * Returns AIStructuredResult if matched with high confidence (>= 0.70).
   * Returns null if confidence < 0.70 or match fails (instructing orchestrator to fallback to RAG/LLM/Structured).
   */
  async routeQuery(
    prompt: string,
    context: AIContext,
    options?: RouteOptions
  ): Promise<(AIStructuredResult & { suppressAutoReply?: boolean }) | null> {
    const repos = options?.repos;


    // 1. PII Redaction on prompt for safety
    const { sanitized: sanitizedPrompt } = sanitizePiiText(prompt);

    // 2. Normalize customer message using dictionary (typo correction + exact product token preservation)
    const { normalizedText, preservedTokens } = normalizeCustomerMessage(
      sanitizedPrompt,
      this.dataset.dictionary
    );
    const lowerNormalized = normalizedText.toLowerCase();
    const lowerPrompt = sanitizedPrompt.toLowerCase();

    // 3. Extract entities (product, quantity, color, location, order_reference)
    const entities = extractEntities(normalizedText);
    if (!entities.product && preservedTokens.length > 0) {
      entities.product = preservedTokens[0];
    }

    // 4. Intent Matching & Confidence Scoring
    const matches = this.matchIntents(lowerPrompt, lowerNormalized, entities);

    if (matches.length === 0) {
      return null;
    }

    // Sort matches by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    const primaryMatch = matches[0];

    // Confidence Gate: if top match < 0.70 -> FALLBACK to RAG / LLM / Handoff
    if (primaryMatch.confidence < 0.70 || primaryMatch.route === 'FALLBACK') {
      return null;
    }

    // 5. Multi-Intent Handling: check if prompt contains multiple distinct high-confidence intents
    const secondaryMatches = matches.slice(1).filter(
      (m) => m.confidence >= 0.75 && m.intentId !== primaryMatch.intentId
    );

    // 6. Answer Generation & Dynamic DB Lookup
    const primaryResult = await this.renderMatch(primaryMatch, prompt, context, repos, options);
    if (!primaryResult) return null;

    if (secondaryMatches.length > 0) {
      const secondaryResult = await this.renderMatch(secondaryMatches[0], prompt, context, repos, options);
      if (secondaryResult && secondaryResult.replyText && secondaryResult.replyText !== primaryResult.replyText) {
        const combinedText = `${primaryResult.replyText}\n${secondaryResult.replyText}`;
        return {
          ...primaryResult,
          replyText: combinedText,
          needsHandoff: primaryResult.needsHandoff || secondaryResult.needsHandoff,
          handoffReason: primaryResult.handoffReason || secondaryResult.handoffReason,
        };
      }
    }

    return primaryResult;
  }

  private matchIntents(
    lowerPrompt: string,
    lowerNormalized: string,
    entities: ExtractedEntities
  ): TemplateMatchResult[] {
    const results: TemplateMatchResult[] = [];

    const qaMap = new Map<string, TemplateQAItem>();
    for (const item of this.dataset.templateQA) {
      qaMap.set(item.intent_id, item);
    }

    for (const compactItem of this.dataset.routerCompact) {
      const qaItem = qaMap.get(compactItem.intent) || qaMap.get(compactItem.template_id);
      let bestConfidence = 0;
      let matchedPattern: string | undefined;

      // Match against patterns in compact router
      for (const pattern of compactItem.patterns) {
        const lowerPattern = pattern.toLowerCase().trim();
        if (!lowerPattern) continue;

        // Exact match
        if (lowerNormalized === lowerPattern || lowerPrompt === lowerPattern) {
          bestConfidence = 0.98;
          matchedPattern = pattern;
          break;
        }

        // Substring / Word boundary match
        if (lowerPattern.length <= 4) {
          // Short pattern (e.g., "ok", "ha", "xa", "da", "hop") -> MUST use word boundary \b
          const escaped = lowerPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
          if (wordRegex.test(lowerNormalized) || wordRegex.test(lowerPrompt)) {
            if (lowerNormalized.length <= 15) {
              bestConfidence = Math.max(bestConfidence, 0.92);
              matchedPattern = pattern;
            }
          }
        } else {
          // Long pattern match
          if (lowerNormalized.includes(lowerPattern) || lowerPrompt.includes(lowerPattern)) {
            bestConfidence = Math.max(bestConfidence, 0.92);
            matchedPattern = pattern;
          }
        }
      }

      // Keyword & Intent Heuristics
      if (bestConfidence < 0.70) {
        if (compactItem.intent === 'GREETING' && /^(salom|assalomu|ассалому|привет|hello|hi)$/i.test(lowerNormalized)) {
          bestConfidence = 0.95;
        } else if (compactItem.intent === 'THANKS' && /^(rahmat|рахмат|раҳмат|thanks|thank you|спасибо)$/i.test(lowerNormalized)) {
          bestConfidence = 0.95;
        } else if (compactItem.intent === 'CONFIRMATION' && /^(ok|hop|xa|ha|да|xo'p|хоп|ҳоп)$/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'PRICE' && /(narx|narxi|narxlar|нарх|нечпул|нецпул|қанчадан|qanchadan|price|cost|сколько стоит|скока)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'STOCK_AVAILABILITY' && /(bormi|mavjudmi|борми|мавжудми|qoldiq|ombor|sklad|stock|есть)/i.test(lowerNormalized) && !/(narx|narxi|нарх)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'DISCOUNT' && /(skidka|skidkali|chegirma|bonus|скидка|чегирма)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'SAMPLE' && /(namuna|obrazets|образец|намуна)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'LOCATION' && /(lokatsiya|manzilimiz|manzil|адрес|локация|манзил)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'PHOTO_REQUEST' && /(rasm|фото|photo|расм)/i.test(lowerNormalized) && /(tashang|yuboring|ob tashen|отправьте|юборинг)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if ((compactItem.intent === 'MANAGER_REQUEST' || compactItem.intent === 'CUSTOMER_REQUESTED_MANAGER' || compactItem.intent === 'HANDOFF_REQUIRED') && /(menejer|менежер|менеджер|gaplashmoqchiman|гаплашмоқчиман|поговорить)/i.test(lowerNormalized)) {
          bestConfidence = 0.95;
        }
      }

      if (bestConfidence >= 0.70) {
        const requiredEntities = qaItem?.required_entities || compactItem.entities || [];
        const missingRequired = requiredEntities.some((reqEnt) => !entities[reqEnt]);

        let route: 'DETERMINISTIC' | 'CONFIRM' | 'FALLBACK' = 'FALLBACK';
        if (bestConfidence >= 0.90 && !missingRequired) {
          route = 'DETERMINISTIC';
        } else if (bestConfidence >= 0.70) {
          route = 'CONFIRM';
        }

        results.push({
          intentId: compactItem.intent,
          templateId: compactItem.template_id,
          answerMode: compactItem.answer_mode,
          confidence: bestConfidence,
          route,
          extractedEntities: entities,
          matchedPattern,
          leadSignal: qaItem?.lead_signal || 'NONE',
          handoff: compactItem.handoff || qaItem?.handoff || false,
          requiredEntitiesMissing: missingRequired,
        });
      }
    }

    return results;
  }

  private async renderMatch(
    match: TemplateMatchResult,
    prompt: string,
    context: AIContext,
    repos?: Repositories,
    options?: RouteOptions
  ): Promise<(AIStructuredResult & { suppressAutoReply?: boolean }) | null> {
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const isRu = lang === 'ru';
    const isCyrl = lang === 'uz-Cyrl';

    const qaMap = new Map<string, TemplateQAItem>();
    for (const item of this.dataset.templateQA) {
      qaMap.set(item.intent_id, item);
    }
    const qaItem = qaMap.get(match.intentId) || qaMap.get(match.templateId);

    // ── 1. HANDOFF_REQUIRED Intents ──────────────────────────────────────────
    if (match.handoff || (qaItem && qaItem.handoff)) {
      const handoffReply = isRu
        ? 'Ваш запрос передан менеджеру. Пожалуйста, ожидайте.'
        : isCyrl
        ? 'Сўровингиз менежерга узатилди. Илтимос, кутинг.'
        : 'So‘rovingiz menejerga uzatildi. Iltimos, kuting.';

      return {
        replyText: handoffReply,
        language: lang,
        intent: match.intentId,
        confidence: match.confidence,
        needsHandoff: true,
        handoffReason: `TEMPLATE_HANDOFF_${match.intentId}`,
        suppressAutoReply: true,
        leadSignals: match.extractedEntities.product ? { productNeed: match.extractedEntities.product } : {},
        usedKnowledgeIds: [],
      };
    }

    // ── 2. DYNAMIC_DATABASE Intent Rendering ─────────────────────────────────
    if (match.answerMode === 'DYNAMIC_DATABASE') {
      const productCode = match.extractedEntities.product;

      // Handle DISCOUNT intent
      if (match.intentId === 'DISCOUNT') {
        const discountTemplate = qaItem?.answer_templates?.unknown ||
          (isRu
            ? 'Индивидуальные скидки согласовываются с менеджером.'
            : isCyrl
            ? 'Чегирмалар менежер билан келишилади.'
            : 'Chegirmalar menejer bilan kelishiladi.');

        return {
          replyText: discountTemplate,
          language: lang,
          intent: 'discount_inquiry',
          confidence: match.confidence,
          needsHandoff: true,
          handoffReason: 'DISCOUNT_APPROVAL_REQUIRED',
          suppressAutoReply: true,
          leadSignals: productCode ? { productNeed: productCode } : {},
          usedKnowledgeIds: [],
        };
      }

      // If productCode is missing for PRICE / STOCK, return null to let orchestrator handle missing entity
      if (!productCode) {
        return null;
      }

      let activeProduct = (context.availableProducts || []).find(
        (p) => p.name.toUpperCase().includes(productCode.toUpperCase()) || p.category.toUpperCase().includes(productCode.toUpperCase())
      );

      if (!activeProduct && repos) {
        const allProducts = await repos.products.findAll({ activeOnly: true });
        activeProduct = allProducts.find(
          (p) => p.name.toUpperCase().includes(productCode.toUpperCase()) || p.category.toUpperCase().includes(productCode.toUpperCase())
        );
      }

      // If active product not found or inactive, yield to orchestrator's unmatched product fallback
      if (!activeProduct || activeProduct.active === false) {
        return null;
      }

      if (match.intentId === 'PRICE') {
        let currentPrice: number | undefined = activeProduct.price;
        let currency = activeProduct.currency || 'USD';

        if (repos) {
          const priceObj = await repos.productPrices.findActiveByProductId(activeProduct.id);
          if (priceObj && priceObj.price > 0) {
            currentPrice = priceObj.price;
            currency = priceObj.currency || currency;
          }
        }

        if (currentPrice && currentPrice > 0) {
          const priceText = isRu
            ? `Цена ${activeProduct.name}: ${currentPrice} ${currency}.`
            : isCyrl
            ? `${activeProduct.name} нархи: ${currentPrice} ${currency}.`
            : `${activeProduct.name} narxi: ${currentPrice} ${currency}.`;
          return {
            replyText: priceText,
            language: lang,
            intent: 'product_price',
            confidence: 0.95,
            needsHandoff: false,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        }

        // Missing active price in DB
        return {
          replyText: isRu
            ? 'Цена уточняется у менеджера.'
            : isCyrl
            ? 'Жорий нарх тасдиқланмаган. Менежерга узатилади.'
            : 'Joriy narx tasdiqlanmagan. Menejerga uzatiladi.',
          language: lang,
          intent: 'product_price',
          confidence: 0.70,
          needsHandoff: true,
          handoffReason: 'MISSING_ACTIVE_PRICE',
          suppressAutoReply: true,
          leadSignals: { productNeed: activeProduct.name },
          usedKnowledgeIds: [],
        };
      }

      if (match.intentId === 'STOCK_AVAILABILITY') {
        let stockStatusStr: string | undefined = activeProduct.stockStatus;

        if (repos) {
          const invObj = await repos.productInventory.findByProductId(activeProduct.id);
          if (invObj) {
            stockStatusStr = invObj.status.toLowerCase();
          }
        }

        if (stockStatusStr === 'in_stock') {
          const stockText = isRu
            ? `${activeProduct.name} есть в наличии.`
            : isCyrl
            ? `${activeProduct.name} омборда мавжуд.`
            : `${activeProduct.name} omborda mavjud.`;
          return {
            replyText: stockText,
            language: lang,
            intent: 'product_stock',
            confidence: 0.95,
            needsHandoff: false,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        } else if (stockStatusStr === 'out_of_stock') {
          const outText = isRu
            ? `${activeProduct.name} нет в наличии.`
            : isCyrl
            ? `${activeProduct.name} омборда мавжуд эмас.`
            : `${activeProduct.name} omborda mavjud emas.`;
          return {
            replyText: outText,
            language: lang,
            intent: 'product_stock',
            confidence: 0.95,
            needsHandoff: true,
            handoffReason: 'INVENTORY_STATUS_OUT_OF_STOCK',
            suppressAutoReply: true,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        }

        // Unknown stock status
        return {
          replyText: isRu
            ? `${activeProduct?.name || productCode}: наличие уточняется у менеджера.`
            : isCyrl
            ? `${activeProduct?.name || productCode}: жорий қолдиқ номаълум. Менежерга узатилади.`
            : `${activeProduct?.name || productCode}: joriy qoldiq noma’lum. Menejerga uzatiladi.`,
          language: lang,
          intent: 'product_stock',
          confidence: 0.70,
          needsHandoff: true,
          handoffReason: 'INVENTORY_STATUS_UNKNOWN',
          suppressAutoReply: true,
          leadSignals: { productNeed: activeProduct.name },
          usedKnowledgeIds: [],
        };
      }
    }

    // ── 3. STATIC_TEMPLATE Intent Rendering ───────────────────────────────────
    let replyText = isRu || isCyrl
      ? (qaItem?.answer_templates?.[lang] || qaItem?.answer_templates?.[isRu ? 'ru' : 'uz-Cyrl'])
      : (qaItem?.answer_templates?.[lang] || qaItem?.answer_templates?.default);

    if (!replyText) {
      if (match.intentId === 'GREETING') {
        replyText = isRu
          ? 'Здравствуйте! Чем я могу вам помочь?'
          : isCyrl
          ? 'Ассалому алайкум! Қандай ёрдам бера оламан?'
          : 'Assalomu alaykum! Qanday yordam bera olaman?';
      } else if (match.intentId === 'THANKS') {
        replyText = isRu
          ? 'Пожалуйста! Рады помочь.'
          : isCyrl
          ? 'Соғ бўлинг! Ёрдам берганимиздан хурсандмиз.'
          : 'Sog‘ bo‘ling! Yordam berganimizdan xursandmiz.';
      } else if (match.intentId === 'CONFIRMATION') {
        replyText = isRu ? 'Понял вас.' : isCyrl ? 'Тушундим, раҳмат.' : 'Tushundim, rahmat.';
      } else if (match.intentId === 'LOCATION') {
        replyText = isRu
          ? 'Наш склад и офисы: Андижан, Коканд, Ташкент. Нужна локация или адрес?'
          : isCyrl
          ? 'Бизнинг склад ва офисларимиз: Андижон, Қўқон, Тошкент. Манзил ёки локация керакми?'
          : 'Bizning sklad va ofislarimiz: Andijon, Qo‘qon, Toshkent. Manzil yoki lokatsiya kerakmi?';
      } else if (match.intentId === 'PHOTO_REQUEST') {
        replyText = isRu
          ? 'Каталог и фото отправим через менеджера. Какой продукт интересует?'
          : isCyrl
          ? 'Каталог ва расмларни менежер орқали юборамиз. Қайси маҳсулот қизиқтиради?'
          : 'Katalog va rasmlarni menejer orqali yuboramiz. Qaysi mahsulot qiziqtiradi?';
      } else if (match.intentId === 'SAMPLE') {
        replyText = isRu
          ? 'По вопросу образца вас свяжут с менеджером.'
          : isCyrl
          ? 'Намуна олиш бўйича сизни менежер билан боғлаймиз.'
          : 'Namuna olish bo‘yicha sizni menejer bilan bog‘laymiz.';
      } else {
        replyText = isRu
          ? 'Информация уточняется. По какому продукту нужен вопрос?'
          : isCyrl
          ? 'Маълумот аниқлаштирилмоқда. Қайси маҳсулот бўйича ёрдам керак?'
          : 'Ma’lumot aniqlashtirilmoqda. Qaysi mahsulot bo‘yicha yordam kerak?';
      }
    }

    const protectedActionRegex = /(tekshiraman|aniqlab beraman|yuboraman|проверю|отправлю)/i;
    if (!options?.actionExecuted && protectedActionRegex.test(replyText)) {
      replyText = replyText.replace(protectedActionRegex, 'ma\'lumot beraman');
    }

    return {
      replyText,
      language: lang,
      intent: match.intentId,
      confidence: match.confidence,
      needsHandoff: false,
      leadSignals: match.extractedEntities.product ? { productNeed: match.extractedEntities.product } : {},
      usedKnowledgeIds: [],
    };
  }
}
