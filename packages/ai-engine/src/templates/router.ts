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
        const combinedReasons = [primaryResult.handoffReason, secondaryResult.handoffReason].filter(Boolean);
        return {
          ...primaryResult,
          replyText: combinedText,
          needsHandoff: primaryResult.needsHandoff || secondaryResult.needsHandoff,
          handoffReason: combinedReasons.length > 0 ? combinedReasons.join(';') : undefined,
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
        } else if (compactItem.intent === 'STOCK_AVAILABILITY' && /(bormi|mavjudmi|борми|мавжудми|qoldiq|ombor|sklad|stock|есть)/i.test(lowerNormalized)) {
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

    // ── 1. DYNAMIC_DATABASE Intent Rendering (Evaluates dynamic truth first) ─
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
        let currentPrice: number | null = null;
        let currency = 'USD';
        let unit = 'kg';
        let minQty = 1;

        if (context.structuredBusinessFacts) {
          const fact = context.structuredBusinessFacts.products.find((f) => f.id === activeProduct.id);
          if (fact?.activePrice) {
            currentPrice = fact.activePrice.amount;
            currency = fact.activePrice.currency;
            unit = fact.activePrice.unit;
            minQty = fact.activePrice.minimumQuantity;
          }
        } else if (repos && repos.productPrices) {
          const priceObj = await repos.productPrices.findActiveByProductId(activeProduct.id);
          const now = new Date();
          if (priceObj && priceObj.active && (!priceObj.validUntil || new Date(priceObj.validUntil) > now)) {
            currentPrice = priceObj.price;
            currency = priceObj.currency || 'USD';
            unit = priceObj.unit || 'kg';
            minQty = priceObj.minimumQuantity || 1;
          } else if (activeProduct.price && activeProduct.price > 0 && !priceObj) {
            currentPrice = activeProduct.price;
            currency = activeProduct.currency || 'USD';
          }
        } else if (activeProduct.price && activeProduct.price > 0) {
          currentPrice = activeProduct.price;
          currency = activeProduct.currency || 'USD';
        }

        if (currentPrice !== null && currentPrice > 0) {
          const priceText = isRu
            ? `Цена ${activeProduct.name}: ${currentPrice} ${currency} за 1 ${unit}. Мин. заказ (MOQ): ${minQty} ${unit}.`
            : isCyrl
            ? `${activeProduct.name} нархи 1 ${unit} учун ${currentPrice} ${currency}. Минимал буюртма (MOQ): ${minQty} ${unit}.`
            : `${activeProduct.name} narxi 1 ${unit} uchun ${currentPrice} ${currency}. Minimal buyurtma (MOQ): ${minQty} ${unit}.`;
          return {
            replyText: priceText,
            language: lang,
            intent: 'product_price',
            confidence: 0.98,
            needsHandoff: false,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        }

        // Missing active price in DB — Strict Business Truth (No fabricated numbers, no legacy price fallback)
        return {
          replyText: isRu
            ? `Действующая цена для ${activeProduct.name} не подтверждена в базе. Менеджер свяжется с вами.`
            : isCyrl
            ? `${activeProduct.name} учун амалдаги нарх базада тасдиқланмаган. Аниқ нарх бўйича менежеримиз боғланади.`
            : `${activeProduct.name} uchun amaldagi narx bazada tasdiqlanmagan. Aniq narx va tijoriy taklif uchun menejerimiz siz bilan bog'lanadi.`,
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
        let inventoryObj: any = null;

        if (context.structuredBusinessFacts) {
          const fact = context.structuredBusinessFacts.products.find((f) => f.id === activeProduct.id);
          if (fact?.inventory) {
            inventoryObj = fact.inventory;
          }
        } else if (repos && repos.productInventory) {
          inventoryObj = await repos.productInventory.findByProductId(activeProduct.id);
        }

        if (!inventoryObj && !repos && !context.structuredBusinessFacts && activeProduct.stockStatus) {
          const status = activeProduct.stockStatus.toUpperCase();
          inventoryObj = {
            availableQuantity: status === 'IN_STOCK' ? 1000 : 0,
            reservedQuantity: 0,
            status,
          };
        }

        if (!inventoryObj || inventoryObj.status === 'UNKNOWN') {
          // Missing inventory row in DB -> UNKNOWN (Strict Business Truth)
          return {
            replyText: isRu
              ? `Наличие ${activeProduct.name} на складе уточняется у менеджера.`
              : isCyrl
              ? `${activeProduct.name} омбор қолдиғи ҳозирча аниқланмаган. Менежеримиз маълумот беради.`
              : `${activeProduct.name} ombor qoldig'i hozircha aniqlanmagan. Bu bo'yicha menejerimiz sizga ma'lumot beradi.`,
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

        const avail = inventoryObj.availableQuantity ?? 0;
        const res = inventoryObj.reservedQuantity ?? 0;
        const net = Math.max(0, avail - res);

        if (inventoryObj.status === 'OUT_OF_STOCK' || net <= 0) {
          const outText = isRu
            ? `${activeProduct.name} нет в наличии.`
            : isCyrl
            ? `${activeProduct.name} айни пайтда омборда мавжуд эмас.`
            : `${activeProduct.name} ayni paytda omborda mavjud emas. Buyurtma qilish yoki keyingi partiya muddatini bilish uchun menejerimiz bog'lanadi.`;
          return {
            replyText: outText,
            language: lang,
            intent: 'product_stock',
            confidence: 0.98,
            needsHandoff: true,
            handoffReason: 'INVENTORY_STATUS_OUT_OF_STOCK',
            suppressAutoReply: true,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        }

        // Positive stock
        const stockText = isRu
          ? `${activeProduct.name} есть в наличии.`
          : isCyrl
          ? `${activeProduct.name} омборда мавжуд (${net} кг қолдиқ).`
          : `${activeProduct.name} omborda mavjud (${net} kg qoldiq). Buyurtma miqdorini bildirsangiz, rasmiylashtirishda yordam beraman.`;
        return {
          replyText: stockText,
          language: lang,
          intent: 'product_stock',
          confidence: 0.98,
          needsHandoff: false,
          leadSignals: { productNeed: activeProduct.name },
          usedKnowledgeIds: [],
        };
      }
    }

    // ── 2. HANDOFF_REQUIRED Intents ──────────────────────────────────────────
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
