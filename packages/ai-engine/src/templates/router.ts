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
import { MASTER_RESPONSES_UZ } from './master-responses.js';
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

    // Payment-type follow-up: "naqd" / "o‘tkazma" must retain the product
    // from the preceding customer message instead of losing conversation context.
    const isPaymentOnly = /^(naqd|cash|o['‘’]?tkazma|otkazma|perechislenie|bank|перечисление|наличными)[?!. ]*$/i.test(lowerNormalized);
    if (isPaymentOnly && !entities.product && context.conversationHistory?.length) {
      const priorMessages = [...context.conversationHistory].reverse();
      let priorProduct: string | undefined;
      for (const message of priorMessages) {
        const priorEntities = extractEntities(message.content);
        if (priorEntities.product) {
          priorProduct = priorEntities.product;
          break;
        }
        const productMatch = (context.availableProducts || []).find((product) => {
          const text = message.content.toUpperCase();
          return [product.count, product.code, product.name]
            .filter(Boolean)
            .some((value) => text.includes(String(value).toUpperCase()));
        });
        if (productMatch) {
          priorProduct = productMatch.count || productMatch.code || productMatch.name;
          break;
        }
      }
      if (priorProduct) {
        return this.routeQuery(`${priorProduct} ${normalizedText} narxi qancha?`, {
          ...context,
          conversationHistory: [],
        }, options);
      }
    }

    // Master DOCX responses are the canonical deterministic replies for Uzbek.
    // Keep this before dataset matching so historical Telegram answers cannot win.
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const isUzbek = lang !== 'ru';
    const staticResult = (
      replyText: string,
      intent: string,
      needsHandoff = false,
      handoffReason?: string
    ): AIStructuredResult & { suppressAutoReply?: boolean } => ({
      replyText,
      language: lang,
      intent,
      confidence: 0.99,
      needsHandoff,
      handoffReason,
      suppressAutoReply: needsHandoff || undefined,
      leadSignals: entities.product ? { productNeed: entities.product } : {},
      usedKnowledgeIds: [],
    });

    if (isUzbek) {
      if (/^(xayr|hayr|salomat bo['‘’]?ling|omon bo['‘’]?ling)$/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.goodbye, 'farewell');
      }
      if (/^(rahmat|raxmat|tashakkur)$/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.thanks, 'thanks');
      }
      if (/^(qalaysiz|qaleysiz|yaxshimisiz|tinchmisiz|ishlar yaxshimi|qandaysiz)[?!. ]*$/i.test(lowerNormalized)) {
        return staticResult(
          lowerNormalized.includes('yaxshimisiz') || lowerNormalized.includes('tinchmisiz')
            ? MASTER_RESPONSES_UZ.greetingFollowUp
            : MASTER_RESPONSES_UZ.greetingStandard,
          'wellbeing'
        );
      }
      if (/^(salom|assalomu alaykum|assalomu aleykum)[?!. ]*$/i.test(lowerNormalized)) {
        return staticResult(
          context.isNewConversation === false
            ? MASTER_RESPONSES_UZ.greetingOngoing
            : MASTER_RESPONSES_UZ.greetingNew,
          'greeting'
        );
      }
      if (/(sen|siz).*(ai|bot|robot)|(ai|bot).*(misan|misiz)|sen kimsan|kim bu/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.identity, 'bot_identity');
      }
      if (/(qachon|qancha vaqtda).*(menejer|manager).*(yoz|bog|aloqa)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.managerContactTime, 'manager_timing');
      }
      if (/(menejer|menedjer|manager).*(gaplash|kerak|bog|aloqa)|gaplash.*(menejer|manager)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.managerHandoff, 'manager_request', true, 'CUSTOMER_REQUESTED_MANAGER');
      }
      if (/(namuna|obrazets|sample|namunalar)/i.test(lowerNormalized)) {
        const history = context?.conversationHistory || [];
        const hasRecentSampleReply = history.some(
          (m) => m.role === 'assistant' && m.content.includes('namunalar bepul')
        );
        if (hasRecentSampleReply) {
          return staticResult(MASTER_RESPONSES_UZ.sampleFollowUp, 'sample_followup');
        }
        return staticResult(MASTER_RESPONSES_UZ.sampleFree, 'sample_inquiry');
      }
      if (/(chegirma|arzon|skidka|chegirmalar)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.discountGeneral, 'discount_inquiry');
      }
      if (/(kafolat|garantiya)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.warranty, 'warranty_inquiry');
      }
      if (/(to['‘’]?lov shart|qanday to['‘’]?lay|oplata|оплата)/i.test(lowerNormalized)) {
        const history = context?.conversationHistory || [];
        const hasRecentPaymentReply = history.some(
          (m) => m.role === 'assistant' && m.content.includes('100% oldindan to‘lov')
        );
        if (hasRecentPaymentReply) {
          return staticResult(MASTER_RESPONSES_UZ.paymentFollowUp, 'payment_terms_followup');
        }
        return staticResult(MASTER_RESPONSES_UZ.paymentTerms, 'payment_terms');
      }
      if (/(ish vaqt|soat nech|nechigacha ishl|qachon ochiq)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.workingHours, 'working_hours');
      }
      if (/(manzil|adres|lokatsiya|qayerda joylash)/i.test(lowerNormalized)) {
        const history = context?.conversationHistory || [];
        const hasRecentLocationReply = history.some(
          (m) => m.role === 'assistant' && (m.content.includes('Yangiobod ko‘chasi') || m.content.includes('Angren shahri'))
        );
        if (hasRecentLocationReply) {
          return staticResult(MASTER_RESPONSES_UZ.locationFollowUp, 'location_followup');
        }
        return staticResult(MASTER_RESPONSES_UZ.locationAngren, 'location');
      }
      // Urgent Same-Day Dispatch & Delivery Timing
      if (
        /(bugun|hozir|shu bugun|tezda|tezroq).*(yetkaz|dostavka|berol|berasiz|bera ola|chiqar|jo['‘’]?nat|iloji|bo['‘’]?ladimi|ulguradimi)/i.test(lowerNormalized) ||
        /(yetkaz|dostavka|chiqar|jo['‘’]?nat).*(bugun|hozir|qachon|necha kunda)/i.test(lowerNormalized) ||
        /^(bugun|hozir).*(iloji|bo['‘’]?ladimi|ulguradimi)[?!. ]*$/i.test(lowerNormalized)
      ) {
        return staticResult(MASTER_RESPONSES_UZ.deliveryToday, 'delivery_timing', true, 'DELIVERY_TIMING_REQUEST');
      }
      // Generic Delivery Terms & Transport Policy (with anti-repetition memory)
      if (/(yetkaz|dostavka|jo['‘’]?natish)/i.test(lowerNormalized)) {
        const history = context?.conversationHistory || [];
        const hasRecentDeliveryReply = history.some(
          (m) =>
            m.role === 'assistant' &&
            (m.content.includes('Angren fabrikamizdan') || m.content.includes('taksi/fura'))
        );
        if (hasRecentDeliveryReply) {
          return staticResult(MASTER_RESPONSES_UZ.deliveryFollowUp, 'delivery_followup');
        }
        return staticResult(MASTER_RESPONSES_UZ.deliveryTerms, 'delivery');
      }
      if (/(sertifikat|iso|oeko)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.certificates, 'certificates');
      }
      if (/(tarkib|composition|sostav|nimadan ishlab)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.composition, 'composition');
      }
      if (/(qaytar|almashtir|vozvrat)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.returnPolicy, 'return_exchange');
      }
      if (/(brak|uzil|tuklik|sifatsiz|shikoyat)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.complaint, 'complaint', true, 'COMPLAINT_HIGH_PRIORITY');
      }
      if (/(katalog|catalog|ranglar katalog)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.catalogSend, 'catalog', true, 'CATALOG_REQUEST');
      }
      if (/(qanday|qanaqa).*(rang)|ranglar.*(bor|mavjud)/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.colorsInquiry, 'color_clarification');
      }
      if (/^(ip|mahsulot)(lar)?\s+(bormi|mavjudmi)[?!. ]*$/i.test(lowerNormalized)) {
        return staticResult(MASTER_RESPONSES_UZ.unspecifiedProductClarify, 'product_clarification', true, 'PRODUCT_NOT_SPECIFIED');
      }
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

      const isExplicitPrice = /(^|[^\p{L}\p{N}])(narx|narxi|narxlar|narxdan|нарх|нархи|нечпул|нецпул|қанча|қанчадан|qancha|qanchadan|price|cost|сколько|почём|цена|стоимость|стоит|стоят|minimal|минимал|минимальный|moq)($|[^\p{L}\p{N}])/iu.test(lowerNormalized);
      const isExplicitStock = /(^|[^\p{L}\p{N}])(bormi|mavjudmi|борми|мавжудми|qoldiq|қолдиқ|ombor|омбор|sklad|склад|stock|есть|наличии|наличие)($|[^\p{L}\p{N}])/iu.test(lowerNormalized);

      const intentName = (compactItem.intent || (compactItem as any).intent_id || compactItem.template_id || '').toUpperCase();

      // Conflict resolution between price and stock
      if (intentName.includes('PRICE') && isExplicitStock && !isExplicitPrice) {
        bestConfidence = 0;
      } else if (intentName.includes('STOCK') && isExplicitPrice && !isExplicitStock) {
        bestConfidence = 0;
      }

      // Keyword & Intent Heuristics
      if (bestConfidence < 0.70) {
        if (compactItem.intent === 'GREETING' && /^(salom|assalomu|ассалому|привет|hello|hi)$/i.test(lowerNormalized)) {
          bestConfidence = 0.95;
        } else if (compactItem.intent === 'THANKS' && /^(rahmat|рахмат|раҳмат|thanks|thank you|спасибо)$/i.test(lowerNormalized)) {
          bestConfidence = 0.95;
        } else if (compactItem.intent === 'CONFIRMATION' && /^(ok|hop|xa|ha|да|xo'p|хоп|ҳоп)$/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'PRICE' && isExplicitPrice) {
          bestConfidence = 0.96;
        } else if (compactItem.intent === 'STOCK_AVAILABILITY' && isExplicitStock && !isExplicitPrice) {
          bestConfidence = 0.96;
        } else if (compactItem.intent === 'STOCK_AVAILABILITY' && /(kerak|керак|нужен|надо|olmoqchiman)/i.test(lowerNormalized) && !isExplicitPrice) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'DISCOUNT' && /(skidka|skidkali|chegirma|bonus|скидка|чегирма)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'SAMPLE' && /(namuna|obrazets|образец|намуна)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'LOCATION' && /(lokatsiya|manzilimiz|manzil|адрес|локация|манзил)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if (compactItem.intent === 'PHOTO_REQUEST' && /(rasm|фото|photo|расм)/i.test(lowerNormalized) && /(tashang|yuboring|ob tashen|отправьте|юборинг)/i.test(lowerNormalized)) {
          bestConfidence = 0.92;
        } else if ((intentName.includes('MANAGER') || intentName.includes('HANDOFF')) && /(menejer|менежер|менеджер|gaplashmoqchiman|гаплашмоқчиман|поговорить)/i.test(lowerNormalized)) {
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

    const lowerPrompt = prompt.toLowerCase();
    const lowerNormalized = lowerPrompt;

    // ── 0. IDENTITY Intent (Zero Handoff, Strict Factual Assistant Identity) ──
    const isIdentity =
      /^(sen\s+(ai|bot|robot|kim)|siz\s+(ai|bot|robot|kim)|ai\s*misan|botmisan|botmisiz|aimisiz|kim\s*bu|ты\s*(бот|ии|искусственный|кто)|вы\s*(бот|ии|кто)|сен\s*(аи|бот|ким)|сиз\s*(аи|бот|ким)|ким\s*бу|кто\s*ты|вы\s*бот)/i.test(
        lowerNormalized.trim()
      ) ||
      /^(ai\?|bot\?|kim\?|кто\?)$/i.test(lowerNormalized.trim()) ||
      lowerPrompt.includes('sen ai misan') ||
      lowerPrompt.includes('сен аи мисан') ||
      lowerPrompt.includes('ты бот') ||
      lowerPrompt.includes('kim bu') ||
      lowerPrompt.includes('ким бу');

    if (isIdentity) {
      const replyText = isRu
        ? 'Да, я автоматизированный торговый помощник LImax. Помогу вам с информацией по нашей продукции.'
        : isCyrl
        ? 'Ҳа, мен LImax’нинг автоматлаштирилган савдо ёрдамчисиман. Маҳсулотлар бўйича ёрдам бераман.'
        : MASTER_RESPONSES_UZ.identity;
      return {
        replyText,
        language: lang,
        intent: 'bot_identity',
        confidence: 0.99,
        needsHandoff: false,
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    // ── 0.05 Repeated Greeting Check ──
    if ((match.intentId === 'GREETING' || match.templateId?.includes('GREETING')) && context.isNewConversation === false) {
      const repeatGreeting = isRu
        ? 'Слушаю вас, чем могу помочь?'
        : isCyrl
        ? 'Эшитаман, қандай ёрдам бера оламан?'
        : MASTER_RESPONSES_UZ.greetingOngoing;
      return {
        replyText: repeatGreeting,
        language: lang,
        intent: 'greeting',
        confidence: 0.98,
        needsHandoff: false,
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    // ── 0.1 BUSINESS RULES: Samples & Warranty ──
    const isSample = /namuna|namunalar|obrazets|образцы|образец|намуна/i.test(lowerNormalized) || match.intentId === 'SAMPLE';
    if (isSample) {
      const sampleText = isRu
        ? 'Да, мы предоставляем бесплатные образцы.'
        : isCyrl
        ? 'Ҳа, бизда бепул намуналар тақдим этилади.'
        : MASTER_RESPONSES_UZ.sampleFree;
      return {
        replyText: sampleText,
        language: lang,
        intent: 'business_rules_samples',
        confidence: 0.98,
        needsHandoff: false,
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    const isWarranty = /kafolat|garantiya|гарантия|кафолат/i.test(lowerNormalized);
    if (isWarranty) {
      const warrantyText = isRu
        ? 'На нашу продукцию предоставляется гарантия 2 года.'
        : isCyrl
        ? 'Маҳсулотларимизга 2 йил кафолат берилади.'
        : MASTER_RESPONSES_UZ.warranty;
      return {
        replyText: warrantyText,
        language: lang,
        intent: 'business_rules_warranty',
        confidence: 0.98,
        needsHandoff: false,
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    // ── 1. DYNAMIC_DATABASE Intent Rendering (Evaluates dynamic truth first) ─
    const productCode = match.extractedEntities.product;
    const isPriceQuery = /(^|[^\p{L}\p{N}])(narx|narxi|narxlar|narxdan|нарх|нархи|нечпул|нецпул|қанча|қанчадан|qancha|qanchadan|price|cost|сколько|почём|цена|стоимость|стоит|стоят)($|[^\p{L}\p{N}])/iu.test(prompt);
    const isStockQuery = /(^|[^\p{L}\p{N}])(bormi|mavjudmi|борми|мавжудми|qoldiq|қолдиқ|ombor|омбор|sklad|склад|stock|есть|наличии|наличие)($|[^\p{L}\p{N}])/iu.test(prompt);

    if (match.answerMode === 'DYNAMIC_DATABASE' || (productCode && (match.intentId === 'PRICE' || match.intentId === 'STOCK_AVAILABILITY' || isStockQuery || isPriceQuery))) {

      // Handle DISCOUNT intent
      if (match.intentId === 'DISCOUNT') {
        const isLargeBulk = /(?:10|[1-9]\d+)\s*(?:tonna|ton|т|тонна)/i.test(lowerNormalized);
        const discountTemplate =
          isLargeBulk && !isRu && !isCyrl
            ? MASTER_RESPONSES_UZ.largeVolumeHandoff
            : (!isRu && !isCyrl
              ? MASTER_RESPONSES_UZ.discountGeneral
              : (isRu
            ? 'Индивидуальные скидки согласовываются с менеджером.'
            : isCyrl
            ? 'Чегирмалар менежер билан келишилади.'
            : MASTER_RESPONSES_UZ.discountGeneral));

        return {
          replyText: discountTemplate,
          language: lang,
          intent: 'discount_inquiry',
          confidence: match.confidence,
          needsHandoff: isLargeBulk,
          handoffReason: isLargeBulk ? 'DISCOUNT_APPROVAL_REQUIRED' : undefined,
          suppressAutoReply: isLargeBulk || undefined,
          leadSignals: productCode ? { productNeed: productCode } : {},
          usedKnowledgeIds: [],
        };
      }

      // If productCode is missing for PRICE / STOCK, return null to let orchestrator handle missing entity
      if (!productCode) {
        return null;
      }

      // Filter out test/legacy products from runtime queries when repos are used
      let activeProductList = (context.availableProducts || []).filter((p) => p.active !== false);

      if (repos) {
        const allProducts = await repos.products.findAll({ activeOnly: true });
        activeProductList = allProducts.filter(
          (p) =>
            p.active !== false &&
            !p.name.includes('Test Kalava Ip')
        );
      }

      // ── Product & Color Ambiguity Resolution ──
      const cleanUpperCode = productCode.toUpperCase();
      let matchingProds = activeProductList.filter(
        (p) =>
          p.name.toUpperCase().includes(cleanUpperCode) ||
          p.code?.toUpperCase().includes(cleanUpperCode) ||
          p.category.toUpperCase().includes(cleanUpperCode) ||
          p.count?.toUpperCase().includes(cleanUpperCode)
      );

      // If exact full count match exists (e.g. 300D/96 vs W300D/96), narrow down to exact count
      if (cleanUpperCode.includes('/') || cleanUpperCode.startsWith('W300D') || (cleanUpperCode.startsWith('300D') && cleanUpperCode.length > 5)) {
        const escaped = cleanUpperCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactCountMatches = matchingProds.filter(
          (p) =>
            p.count?.toUpperCase() === cleanUpperCode ||
            (new RegExp(`\\b${escaped}\\b`, 'i').test(p.name) && (!cleanUpperCode.startsWith('W') ? !p.name.toUpperCase().includes(`W${cleanUpperCode}`) : true))
        );
        if (exactCountMatches.length > 0) {
          matchingProds = exactCountMatches;
        }
      }

      // Secondary search if e.g. "300 lik poliester" or "300"
      if (matchingProds.length === 0 && /\b300\b/.test(prompt)) {
        matchingProds = activeProductList.filter((p) => p.name.includes('300D') || p.code?.includes('300D'));
      }

      if (matchingProds.length === 0) {
        return null;
      }

      const isBlack = /qora|black|черн|қора/i.test(prompt);
      const isWhite = /oq|white|бел|оқ/i.test(prompt);
      const isMix = /mix|mic/i.test(prompt);
      const specifiedColor = isBlack ? 'BLACK' : isWhite ? 'WHITE' : isMix ? 'MIX COLOR' : null;

      // Handle Product Ambiguity (e.g. 300D/96 vs W300D/96)
      const distinctTypes = Array.from(
        new Set(
          matchingProds.map((p) => {
            const m = p.name.match(/\b(?:W\d+D\/\d+|\d+D\/\d+|\d+K|\d+\/\d+)\b/i);
            return m ? m[0].toUpperCase() : (p.count || p.code?.split('-')[1] || p.name);
          })
        )
      );
      if (distinctTypes.length > 1 && !specifiedColor && matchingProds.length >= 4) {
        const typeChoices = distinctTypes.slice(0, 3).join(' yoki ');
        const clarifyText = isRu
          ? `Вам нужен ${distinctTypes.slice(0, 3).join(' или ')}?`
          : isCyrl
          ? `${distinctTypes.slice(0, 3).join(' ёки ')} керакми?`
          : `${typeChoices} kerakmi?`;
        return {
          replyText: clarifyText,
          language: lang,
          intent: 'product_clarification',
          confidence: 0.95,
          needsHandoff: false,
          leadSignals: {},
          usedKnowledgeIds: [],
        };
      }

      // Handle Color Ambiguity when single product is specified (e.g. "300D/96 narxi qancha?")
      const availableColors = Array.from(
        new Set(
          matchingProds.map((p) => {
            const m = p.name.match(/\b(BLACK|WHITE|MIX COLOR|MIC COLOR)\b/i);
            return m ? m[0].toUpperCase() : ((p as any).color || '').toUpperCase();
          }).filter(Boolean)
        )
      );
      const isDualPriceProduct = cleanUpperCode.includes('40100') || cleanUpperCode.includes('2070');
      if (!specifiedColor && matchingProds.length > 1 && availableColors.length > 1 && !isDualPriceProduct) {
        const colorClarifyText = isRu
          ? 'Цвет BLACK или WHITE?'
          : isCyrl
          ? 'BLACK ёки WHITE ранг керакми?'
          : 'BLACK yoki WHITE rang kerakmi?';
        return {
          replyText: colorClarifyText,
          language: lang,
          intent: 'product_clarification',
          confidence: 0.95,
          needsHandoff: false,
          leadSignals: {},
          usedKnowledgeIds: [],
        };
      }

      let activeProduct = specifiedColor
        ? matchingProds.find((p) => p.name.toUpperCase().includes(specifiedColor) || p.code?.toUpperCase().includes(specifiedColor) || (p as any).color?.toUpperCase() === specifiedColor) || matchingProds[0]
        : matchingProds[0];

      // ── MOQ INTENT ──
      const isMoqQuery = /minimal|moq|минимал|минимальный|min\s*order/i.test(lowerNormalized);
      if (isMoqQuery) {
        const isMixColor = isMix || (activeProduct as any).color?.toUpperCase().includes('MIX') || (activeProduct as any).color?.toUpperCase().includes('MIC') || activeProduct.name.toUpperCase().includes('MIX') || activeProduct.name.toUpperCase().includes('MIC');
        if (isMixColor) {
          const mixMoqText = isRu
            ? `Для ${activeProduct.name} минимальный заказ составляет 100 кг.`
            : isCyrl
            ? `${activeProduct.name} учун минимал буюртма 100 кг.`
            : MASTER_RESPONSES_UZ.moqMixColor;
          return {
            replyText: mixMoqText,
            language: lang,
            intent: 'product_moq',
            confidence: 0.98,
            needsHandoff: false,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        } else {
          const stdMoqText = isRu
            ? 'Для стандартной продукции (BLACK, WHITE) минимальный заказ (MOQ) не ограничен.'
            : isCyrl
            ? 'Стандарт маҳсулотларимизда (BLACK, WHITE) минимал буюртма талаби (MOQ) йўқ.'
            : MASTER_RESPONSES_UZ.moqStandard;
          return {
            replyText: stdMoqText,
            language: lang,
            intent: 'product_moq',
            confidence: 0.98,
            needsHandoff: false,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        }
      }

      const isExplicitPrice = /(^|[^\p{L}\p{N}])(narx|narxi|narxlar|narxdan|нарх|нархи|нечпул|нецпул|қанча|қанчадан|qancha|qanchadan|price|cost|сколько|почём|цена|стоимость|стоит|стоят)($|[^\p{L}\p{N}])/iu.test(prompt);
      const isExplicitStock = /(^|[^\p{L}\p{N}])(bormi|mavjudmi|борми|мавжудми|qoldiq|қолдиқ|ombor|омбор|sklad|склад|stock|есть|наличии|наличие)($|[^\p{L}\p{N}])/iu.test(prompt);

      if (match.intentId === 'STOCK_AVAILABILITY' || (isExplicitStock && !isExplicitPrice)) {
        // Master rule: every active product is treated as available; never expose inventory state.
        const availText = isRu
          ? `Да, ${activeProduct.name} есть в наличии. Какое количество вам нужно?`
          : isCyrl
          ? `Ҳа, ${activeProduct.name} мавжуд. Қанча миқдор керак?`
          : MASTER_RESPONSES_UZ.stockAvailable(activeProduct.name);

        return {
          replyText: availText,
          language: lang,
          intent: 'product_stock',
          confidence: 0.98,
          needsHandoff: false,
          leadSignals: { productNeed: activeProduct.name },
          usedKnowledgeIds: [],
        };
      }

      if (match.intentId === 'PRICE' || isExplicitPrice) {
        const lowerPrompt = prompt.toLowerCase();
        const isCash = lowerPrompt.includes('naqd') || lowerPrompt.includes('cash') || lowerPrompt.includes('налич');
        const isTransfer =
          lowerPrompt.includes('o‘tkazma') ||
          lowerPrompt.includes('otkazma') ||
          lowerPrompt.includes('o\'tkazma') ||
          lowerPrompt.includes('bank') ||
          lowerPrompt.includes('перечисл');

        if (!isCash && !isTransfer) {
          const productLabel = activeProduct.count || activeProduct.name;
          return {
            replyText: isRu
              ? `Для ${productLabel} нужна цена наличными или по перечислению?`
              : isCyrl
              ? `${productLabel} учун нақд ёки ўтказма нархи керакми?`
              : MASTER_RESPONSES_UZ.priceClarifyPaymentType(productLabel),
            language: lang,
            intent: 'payment_type_clarification',
            confidence: 0.99,
            needsHandoff: false,
            leadSignals: { productNeed: activeProduct.name },
            usedKnowledgeIds: [],
          };
        }

        if (repos && repos.productPrices) {
          const now = new Date();
          // Collect prices for all matching products (e.g. both BLACK and WHITE)
          const allMatchingPrices: { prod: typeof activeProduct; prices: any[] }[] = [];
          for (const p of matchingProds) {
            const pPricesRaw =
              (await repos.productPrices.findByProductId?.(p.id)) ||
              (await repos.productPrices.findActiveByProductId?.(p.id)) ||
              (await (repos.productPrices as any).findAll?.({ productId: p.id })) ||
              [];
            const pPrices = Array.isArray(pPricesRaw) ? pPricesRaw : [pPricesRaw].filter(Boolean);
            const activePrices = pPrices.filter(
              (pr) => pr.active && (!pr.validUntil || new Date(pr.validUntil) > now) && pr.sourceSystem !== 'TEST_SEED'
            );
            if (activePrices.length > 0) {
              allMatchingPrices.push({ prod: p, prices: activePrices });
            }
          }

          // Case A: Product with multiple colors and unspecified color/payment
          if (!specifiedColor && matchingProds.length > 1 && allMatchingPrices.length > 1) {
            const firstPrices = allMatchingPrices[0].prices;
            const bankPr = firstPrices.find((pr) => pr.paymentType === 'BANK_TRANSFER');
            const cashPr = firstPrices.find((pr) => pr.paymentType === 'CASH');

            if (bankPr && cashPr && !isCash && !isTransfer) {
              const codeLabel = activeProduct.count || cleanUpperCode;
              const dualColorText = isRu
                ? `Для ${codeLabel} BLACK и WHITE цена по перечислению ${bankPr.price} ${bankPr.currency}/${bankPr.unit}, наличными ${cashPr.price} ${cashPr.currency}/${cashPr.unit}. Какой цвет вам нужен?`
                : isCyrl
                ? `${codeLabel} BLACK ва WHITE учун ўтказма нархи ${bankPr.price} ${bankPr.currency}/${bankPr.unit}, нақд нархи ${cashPr.price} ${cashPr.currency}/${cashPr.unit}. Қайси ранг керак?`
                : `${codeLabel} BLACK va WHITE uchun o‘tkazma narxi ${bankPr.price} ${bankPr.currency}/${bankPr.unit}, naqd narxi ${cashPr.price} ${cashPr.currency}/${cashPr.unit}. Qaysi rang kerak?`;
              return {
                replyText: dualColorText,
                language: lang,
                intent: 'product_price',
                confidence: 0.98,
                needsHandoff: false,
                leadSignals: { productNeed: activeProduct.name },
                usedKnowledgeIds: [],
              };
            } else if (isCash && cashPr) {
              const codeLabel = activeProduct.count || cleanUpperCode;
              const cashOnlyText = isRu
                ? `Для ${codeLabel} BLACK и WHITE цена наличными ${cashPr.price} ${cashPr.currency}/${cashPr.unit}. Какой цвет вам нужен?`
                : isCyrl
                ? `${codeLabel} BLACK ва WHITE учун нақд нархи ${cashPr.price} ${cashPr.currency}/${cashPr.unit}. Қайси ранг керак?`
                : `${codeLabel} BLACK va WHITE uchun naqd narxi ${cashPr.price} ${cashPr.currency}/${cashPr.unit}. Qaysi rang kerak?`;
              return {
                replyText: cashOnlyText,
                language: lang,
                intent: 'product_price',
                confidence: 0.98,
                needsHandoff: false,
                leadSignals: { productNeed: activeProduct.name },
                usedKnowledgeIds: [],
              };
            } else if (isTransfer && bankPr) {
              const codeLabel = activeProduct.count || cleanUpperCode;
              const transferOnlyText = isRu
                ? `Для ${codeLabel} BLACK и WHITE цена по перечислению ${bankPr.price} ${bankPr.currency}/${bankPr.unit}. Какой цвет вам нужен?`
                : isCyrl
                ? `${codeLabel} BLACK ва WHITE учун ўтказма нархи ${bankPr.price} ${bankPr.currency}/${bankPr.unit}. Қайси ранг керак?`
                : `${codeLabel} BLACK va WHITE uchun o‘tkazma narxi ${bankPr.price} ${bankPr.currency}/${bankPr.unit}. Qaysi rang kerak?`;
              return {
                replyText: transferOnlyText,
                language: lang,
                intent: 'product_price',
                confidence: 0.98,
                needsHandoff: false,
                leadSignals: { productNeed: activeProduct.name },
                usedKnowledgeIds: [],
              };
            }
          }

          // Case B: Single product / specific color resolved
          const singlePrices = (allMatchingPrices.find((x) => x.prod.id === activeProduct.id)?.prices) || [];
          const bankPr = singlePrices.find((p) => p.paymentType === 'BANK_TRANSFER');
          const cashPr = singlePrices.find((p) => p.paymentType === 'CASH');

          let selectedPrice: number | null = null;
          let currency = 'USD';
          let unit = 'kg';

          if (isCash && cashPr) {
            selectedPrice = cashPr.price;
            currency = cashPr.currency || 'USD';
            unit = cashPr.unit || 'kg';
            const priceText = isRu
              ? `${activeProduct.name} цена наличными: ${selectedPrice} ${currency}/${unit}.`
              : isCyrl
              ? `${activeProduct.name} учун нақд нархи ${selectedPrice} ${currency}/${unit}.`
              : MASTER_RESPONSES_UZ.priceCashOnly(activeProduct.name, selectedPrice ?? 0, currency, unit);
            return {
              replyText: priceText,
              language: lang,
              intent: 'product_price',
              confidence: 0.98,
              needsHandoff: false,
              leadSignals: { productNeed: activeProduct.name },
              usedKnowledgeIds: [],
            };
          } else if (isTransfer && bankPr) {
            selectedPrice = bankPr.price;
            currency = bankPr.currency || 'USD';
            unit = bankPr.unit || 'kg';
            const priceText = isRu
              ? `${activeProduct.name} цена по перечислению: ${selectedPrice} ${currency}/${unit}.`
              : isCyrl
              ? `${activeProduct.name} учун ўтказма нархи ${selectedPrice} ${currency}/${unit}.`
              : MASTER_RESPONSES_UZ.priceTransferOnly(activeProduct.name, selectedPrice ?? 0, currency, unit);
            return {
              replyText: priceText,
              language: lang,
              intent: 'product_price',
              confidence: 0.98,
              needsHandoff: false,
              leadSignals: { productNeed: activeProduct.name },
              usedKnowledgeIds: [],
            };
          } else if (bankPr && cashPr) {
            const dualPriceText = isRu
              ? `Для ${activeProduct.name} цена по перечислению ${bankPr.price} ${bankPr.currency}/${bankPr.unit}, наличными ${cashPr.price} ${cashPr.currency}/${cashPr.unit}.`
              : isCyrl
              ? `${activeProduct.name} учун ўтказма нархи ${bankPr.price} ${bankPr.currency}/${bankPr.unit}, нақд нархи ${cashPr.price} ${cashPr.currency}/${cashPr.unit}.`
              : `${activeProduct.name} uchun o‘tkazma narxi ${bankPr.price} ${bankPr.currency}/${bankPr.unit}, naqd narxi ${cashPr.price} ${cashPr.currency}/${cashPr.unit}.`;
            return {
              replyText: dualPriceText,
              language: lang,
              intent: 'product_price',
              confidence: 0.98,
              needsHandoff: false,
              leadSignals: { productNeed: activeProduct.name },
              usedKnowledgeIds: [],
            };
          } else if (singlePrices.length > 0) {
            selectedPrice = singlePrices[0].price;
            currency = singlePrices[0].currency || 'USD';
            unit = singlePrices[0].unit || 'kg';
          }
          if (selectedPrice !== null && selectedPrice > 0) {


            let invObj: any = null;
            if (context.structuredBusinessFacts) {
              const fact = context.structuredBusinessFacts.products.find((f) => f.id === activeProduct.id);
              if (fact?.inventory) invObj = fact.inventory;
            } else if (repos && repos.productInventory) {
              invObj = await repos.productInventory.findByProductId(activeProduct.id);
            }

            if (isStockQuery && invObj && invObj.status === 'OUT_OF_STOCK') {
              const outPriceText = isRu
                ? `${activeProduct.name} цена ${selectedPrice} ${currency}/${unit}, но на складе сейчас нет в наличии.`
                : isCyrl
                ? `${activeProduct.name} нархи ${selectedPrice} ${currency}/${unit}, аммо ҳозирда омборда мавжуд эмас.`
                : `${activeProduct.name} narxi ${selectedPrice} ${currency}/${unit}, ammo hozirda omborda mavjud emas.`;
              return {
                replyText: outPriceText,
                language: lang,
                intent: 'product_price',
                confidence: 0.98,
                needsHandoff: true,
                handoffReason: 'INVENTORY_STATUS_OUT_OF_STOCK',
                suppressAutoReply: true,
                leadSignals: { productNeed: activeProduct.name },
                usedKnowledgeIds: [],
              };
            }

            const priceText = isRu
              ? `Цена ${activeProduct.name}: ${selectedPrice} ${currency} за 1 ${unit}.`
              : isCyrl
              ? `${activeProduct.name} нархи 1 ${unit} учун ${selectedPrice} ${currency}.`
              : `${activeProduct.name} narxi 1 ${unit} uchun ${selectedPrice} ${currency}.`;
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
        }

        if (context.structuredBusinessFacts) {
          const fact = context.structuredBusinessFacts.products.find(
            (f) => f.id === activeProduct.id || (activeProduct.code && f.code === activeProduct.code) || f.name === activeProduct.name
          );
          if (fact?.activePrice) {
            const pr = fact.activePrice;
            const priceText = isRu
              ? `Цена ${activeProduct.name}: ${pr.amount} ${pr.currency} за 1 ${pr.unit}.`
              : isCyrl
              ? `${activeProduct.name} нархи 1 ${pr.unit} учун ${pr.amount} ${pr.currency}.`
              : isCash
              ? MASTER_RESPONSES_UZ.priceCashOnly(activeProduct.name, pr.amount)
              : MASTER_RESPONSES_UZ.priceTransferOnly(activeProduct.name, pr.amount);
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
        } else if (!repos && activeProduct.price && activeProduct.price > 0) {
          const prAmount = activeProduct.price;
          const currency = activeProduct.currency || 'USD';
          const unit = (activeProduct as any).unit || 'kg';
          const priceText = isRu
            ? `Цена ${activeProduct.name}: ${prAmount} ${currency} за 1 ${unit}.`
            : isCyrl
            ? `${activeProduct.name} нархи 1 ${unit} учун ${prAmount} ${currency}.`
            : isCash
            ? MASTER_RESPONSES_UZ.priceCashOnly(activeProduct.name, prAmount)
            : MASTER_RESPONSES_UZ.priceTransferOnly(activeProduct.name, prAmount);
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

        // Missing active price in DB — Strict Business Truth (Never fabricate price)
        return {
          replyText: isRu
            ? `Действующая цена для ${activeProduct.name} не подтверждена в базе. Менеджер свяжется с вами.`
            : isCyrl
            ? `${activeProduct.name} учун амалдаги нарх базада тасдиқланмаган. Аниқ нарх бўйича менежеримиз боғланади.`
            : MASTER_RESPONSES_UZ.unknownPrice(activeProduct.name),
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
    }

    // ── 2. HANDOFF_REQUIRED Intents ──────────────────────────────────────────
    if (match.handoff || (qaItem && qaItem.handoff)) {
      const handoffReply = isRu
        ? 'Ваш запрос передан менеджеру. Пожалуйста, ожидайте.'
        : isCyrl
        ? 'Сўровингиз менежерга узатилди. Илтимос, кутинг.'
        : MASTER_RESPONSES_UZ.managerHandoff;

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
    let replyText: string = (isRu || isCyrl
      ? (qaItem?.answer_templates?.[lang] || qaItem?.answer_templates?.[isRu ? 'ru' : 'uz-Cyrl'])
      : (qaItem?.answer_templates?.[lang] || qaItem?.answer_templates?.default)) || '';

    if (!replyText) {
      if (match.intentId === 'GREETING') {
        replyText = isRu
          ? 'Здравствуйте! Чем я могу вам помочь?'
          : isCyrl
          ? 'Ассалому алайкум! Қандай ёрдам бера оламан?'
          : MASTER_RESPONSES_UZ.greetingStandard;
      } else if (match.intentId === 'THANKS') {
        replyText = isRu
          ? 'Пожалуйста! Рады помочь.'
          : isCyrl
          ? 'Соғ бўлинг! Ёрдам берганимиздан хурсандмиз.'
          : MASTER_RESPONSES_UZ.thanks;
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
          : MASTER_RESPONSES_UZ.catalogHandoff;
      } else if (match.intentId === 'SAMPLE') {
        replyText = isRu
          ? 'По вопросу образца вас свяжут с менеджером.'
          : isCyrl
          ? 'Намуна олиш бўйича сизни менежер билан боғлаймиз.'
          : MASTER_RESPONSES_UZ.sampleFree;
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
