import type {
  AIContext,
  AIStructuredResult,
  Product,
  Repositories,
  StructuredBusinessFacts,
  StructuredProductFact,
  KnowledgeSnippet,
} from '@limax/shared';
import { detectLanguage, calculateLeadScore, applyGuardrails, matchProducts } from './index.js';
import type { IAIProviderAdapter } from './providers/types.js';
import { OpenAIProviderAdapter } from './providers/openai.provider.js';
import { GeminiProviderAdapter } from './providers/gemini.provider.js';
import { ClaudeProviderAdapter } from './providers/claude.provider.js';
import { MockAIProviderAdapter } from './providers/mock.provider.js';
import { loadBehaviorV2Config, type BehaviorV2Config } from './behavior.schema.js';
import { getTemplates } from './localization/templates.js';
import { TemplateQARouter } from './templates/router.js';
import { MASTER_RESPONSES_UZ } from './templates/master-responses.js';

import type { EmbeddingProvider } from './embeddings/types.js';
import { MockEmbeddingProvider } from './embeddings/mock.embedding.js';
import { createEmbeddingProvider } from './embeddings/factory.js';

export interface AIOrchestratorConfig {
  aiMode?: 'mock' | 'real';
  primaryProviderName?: 'openai' | 'gemini' | 'claude' | 'mock';
  fallbackProviderName?: 'openai' | 'gemini' | 'claude' | 'mock';
  timeoutMs?: number;
  confidenceThreshold?: number;
  repos?: Repositories;
  behaviorConfig?: BehaviorV2Config;
  embeddingProvider?: EmbeddingProvider;
}

export interface ProcessQueryOptions {
  repos?: Repositories;
  actionExecuted?: boolean;
}

export class AIOrchestrator {
  private aiMode: 'mock' | 'real';
  private primaryAdapter: IAIProviderAdapter;
  private fallbackAdapter: IAIProviderAdapter;
  private timeoutMs: number;
  private confidenceThreshold: number;
  private repos?: Repositories;
  private behaviorConfig: BehaviorV2Config;
  private embeddingProvider: EmbeddingProvider;

  constructor(configOrRepos?: AIOrchestratorConfig | Repositories, maybeConfig?: AIOrchestratorConfig) {
    let config: AIOrchestratorConfig | undefined = maybeConfig;
    if (configOrRepos && ((configOrRepos as any).products || (configOrRepos as any).conversations)) {
      this.repos = configOrRepos as Repositories;
    } else {
      config = configOrRepos as AIOrchestratorConfig;
      this.repos = config?.repos;
    }
    this.aiMode = config?.aiMode || (process.env.AI_MODE as 'mock' | 'real') || 'mock';
    const primaryName = (config?.primaryProviderName || process.env.AI_PRIMARY_PROVIDER || 'openai') as 'openai' | 'gemini' | 'claude' | 'mock';
    const fallbackName = (config?.fallbackProviderName || process.env.AI_FALLBACK_PROVIDER || 'gemini') as 'openai' | 'gemini' | 'claude' | 'mock';

    this.primaryAdapter = this.resolveAdapter(primaryName);
    this.fallbackAdapter = this.resolveAdapter(fallbackName);
    this.timeoutMs = config?.timeoutMs || 30000;
    this.confidenceThreshold = config?.confidenceThreshold || 0.65;
    this.behaviorConfig = config?.behaviorConfig || loadBehaviorV2Config();
    this.embeddingProvider = config?.embeddingProvider || (this.aiMode === 'mock' ? new MockEmbeddingProvider() : createEmbeddingProvider());
  }

  getBehaviorConfig(): BehaviorV2Config {
    return this.behaviorConfig;
  }

  private resolveAdapter(name: string): IAIProviderAdapter {
    switch (name) {
      case 'openai':
        return new OpenAIProviderAdapter();
      case 'gemini':
        return new GeminiProviderAdapter();
      case 'claude':
        return new ClaudeProviderAdapter();
      default:
        return new MockAIProviderAdapter();
    }
  }

  async processQuery(
    prompt: string,
    context: AIContext = {},
    options?: ProcessQueryOptions
  ): Promise<AIStructuredResult & { suppressAutoReply?: boolean }> {
    const repos = options?.repos || this.repos;
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const templates = getTemplates(lang);
    const lowerPrompt = prompt.toLowerCase();

    // 1. Existing WAITING_MANAGER check - Bypass suppression so bot continues replying to user inquiries
    // (Manager notification can still be active without muting AI responses)

    // 2. Guardrail & Prompt Injection Pre-Check
    const guard = applyGuardrails(prompt, { lastResponse: context.lastResponse });
    if (!guard.allowed || lowerPrompt.includes('system prompt') || lowerPrompt.includes('api key') || lowerPrompt.includes('oldingi qoidalarni unut') || lowerPrompt.includes('ignore previous instructions')) {
      const res = await this.formatAndRecordHandoff(
        {
          replyText: templates.securityBlocked(),
          language: lang,
          intent: 'security_blocked',
          confidence: 0.1,
          needsHandoff: true,
          handoffReason: guard.reason || 'PROMPT_INJECTION_BLOCKED',
          leadSignals: {},
          usedKnowledgeIds: [],
        },
        context,
        repos
      );
      return this.enforceActionHonesty(res, options?.actionExecuted, templates);
    }

    // ── 0. IDENTITY Intent (Zero Handoff, Strict Assistant Identity across uz-Latn, uz-Cyrl, ru) ──
    const isIdentity =
      /^(sen\s+(ai|bot|robot|kim)|siz\s+(ai|bot|robot|kim)|ai\s*misan|botmisan|botmisiz|aimisiz|kim\s*bu|ты\s*(бот|ии|искусственный|кто)|вы\s*(бот|ии|кто)|сен\s*(аи|бот|ким)|сиз\s*(аи|бот|ким)|ким\s*бу|кто\s*ты|вы\s*бот)/i.test(
        lowerPrompt.trim()
      ) ||
      /^(ai\?|bot\?|kim\?|кто\?|sen\s*kimsan|сен\s*кимсан|кто\s*ты)$/i.test(lowerPrompt.trim()) ||
      lowerPrompt.includes('sen ai misan') ||
      lowerPrompt.includes('сен аи мисан') ||
      lowerPrompt.includes('sen kimsan') ||
      lowerPrompt.includes('сен кимсан') ||
      lowerPrompt.includes('ты бот') ||
      lowerPrompt.includes('кто ты') ||
      lowerPrompt.includes('kim bu') ||
      lowerPrompt.includes('ким бу');

    if (isIdentity) {
      return {
        replyText: templates.identityResponse(),
        language: lang,
        intent: 'bot_identity',
        confidence: 0.99,
        needsHandoff: false,
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    if (guard.triggerHandoff && guard.reason === 'COMPLAINT_HANDOFF') {
      const res = await this.formatAndRecordHandoff(
        {
          replyText: `${templates.complaintApology()} ${templates.requestEvidence()}`,
          language: lang,
          intent: 'complaint',
          confidence: 0.8,
          needsHandoff: true,
          handoffReason: 'COMPLAINT_HIGH_PRIORITY',
          leadSignals: {},
          usedKnowledgeIds: [],
        },
        context,
        repos,
        'high'
      );
      return this.enforceActionHonesty(res, options?.actionExecuted, templates);
    }

    // 3. Assemble Structured PostgreSQL Business Facts (Priority 1 Truth)
    let availableProducts: Product[] = context.availableProducts || [];
    if (repos && availableProducts.length === 0) {
      availableProducts = await repos.products.findAll({ activeOnly: true });
    }

    const activeProducts = availableProducts.filter((p) => p.active !== false);
    const structuredFacts: StructuredBusinessFacts = repos
      ? await this.assembleStructuredFacts(repos, activeProducts)
      : { products: [], salesSettings: null };
    const templateContext: AIContext = {
      ...context,
      availableProducts: activeProducts,
      structuredBusinessFacts: structuredFacts,
    };

    // 3.1. Template Q&A Router Stage (Priority 0 — Zero Cost / Business Rules & Deterministic Routing)
    const templateRouter = new TemplateQARouter();
    const templateResult = await templateRouter.routeQuery(prompt, templateContext, {
      repos,
      actionExecuted: options?.actionExecuted,
    });

    if (templateResult && templateResult.confidence >= 0.70) {
      const needsHandoff =
        templateResult.needsHandoff ||
        templateResult.confidence < this.confidenceThreshold;

      if (needsHandoff) {
        const res = await this.formatAndRecordHandoff(
          { ...templateResult, needsHandoff: true },
          templateContext,
          repos,
          templateResult.intent === 'complaint' ? 'high' : 'medium'
        );
        return this.enforceActionHonesty(res, options?.actionExecuted, templates);
      }
      return this.enforceActionHonesty(templateResult, options?.actionExecuted, templates);
    }

    // 3.2. Safety Guardrails & Handoff Interception
    if (guard.triggerHandoff && guard.reason === 'SAMPLE_UNVERIFIED_HANDOFF') {
      const res = await this.formatAndRecordHandoff(
        {
          replyText: templates.sampleUnverified(),
          language: lang,
          intent: 'sample_request',
          confidence: 0.8,
          needsHandoff: true,
          handoffReason: 'SAMPLE_UNVERIFIED',
          leadSignals: {},
          usedKnowledgeIds: [],
        },
        context,
        repos
      );
      return this.enforceActionHonesty(res, options?.actionExecuted, templates);
    }

    // 3.3. Manager direct request
    if (lowerPrompt.includes('menejer') || lowerPrompt.includes('menedjer') || lowerPrompt.includes('manager') || lowerPrompt.includes('менеджер')) {
      const res = await this.formatAndRecordHandoff(
        {
          replyText: templates.managerHandoff(),
          language: lang,
          intent: 'manager_request',
          confidence: 0.95,
          needsHandoff: true,
          handoffReason: 'CUSTOMER_MANAGER_REQUEST',
          leadSignals: {},
          usedKnowledgeIds: [],
        },
        context,
        repos
      );
      return this.enforceActionHonesty(res, options?.actionExecuted, templates);
    }

    // 4.1. Fast Direct Product Resolution for Price / Stock Queries
    const matchedProducts = matchProducts(prompt, activeProducts);
    const isPriceOrStockQuery =
      lowerPrompt.includes('narxi') ||
      lowerPrompt.includes('narx') ||
      lowerPrompt.includes('qancha') ||
      lowerPrompt.includes('price') ||
      lowerPrompt.includes('moq') ||
      lowerPrompt.includes('ombor') ||
      lowerPrompt.includes('stock') ||
      lowerPrompt.includes('bormi') ||
      lowerPrompt.includes('борми') ||
      lowerPrompt.includes('есть') ||
      lowerPrompt.includes('почём') ||
      lowerPrompt.includes('сколько');

    if (isPriceOrStockQuery) {
      if (matchedProducts.length > 0) {
        const prod = matchedProducts[0];
        const fact = structuredFacts.products.find((f) => f.id === prod.id);

        const isStockQuery = lowerPrompt.includes('ombor') || lowerPrompt.includes('stock') || lowerPrompt.includes('bormi') || lowerPrompt.includes('борми') || lowerPrompt.includes('есть');
        const isPriceQuery = lowerPrompt.includes('narxi') || lowerPrompt.includes('price') || lowerPrompt.includes('moq') || lowerPrompt.includes('почём') || lowerPrompt.includes('сколько');

        // Stock truth check (Stage 17.4: Active products are available)
        if (isStockQuery && !isPriceQuery) {
          // Active product is available (No inventory numbers)
          return this.enforceActionHonesty(
            {
              replyText: lang === 'ru'
                ? `Да, ${prod.name} есть. Какое количество вам нужно?`
                : MASTER_RESPONSES_UZ.stockAvailable(prod.name),
              language: lang,
              intent: 'product_stock',
              confidence: 0.98,
              needsHandoff: false,
              leadSignals: { productNeed: prod.name },
              usedKnowledgeIds: [],
            },
            options?.actionExecuted,
            templates
          );
        }

        const asksCash = /naqd|cash|налич/i.test(lowerPrompt);
        const asksTransfer = /o['‘’]?tkazma|otkazma|bank|perechis|перечисл/i.test(lowerPrompt);
        if (isPriceQuery && !asksCash && !asksTransfer) {
          return {
            replyText: lang === 'ru'
              ? `Для ${prod.name} нужна цена наличными или по перечислению?`
              : MASTER_RESPONSES_UZ.priceClarifyPaymentType(prod.name),
            language: lang,
            intent: 'payment_type_clarification',
            confidence: 0.99,
            needsHandoff: false,
            leadSignals: { productNeed: prod.name },
            usedKnowledgeIds: [],
          };
        }

        // Price truth check (Strict: NO legacy products.price fallback when pricing table is available!)
        let activePriceVal: number | null = null;

        if (fact?.activePrice) {
          activePriceVal = fact.activePrice.amount;
        } else if (repos && repos.productPrices) {
          const pObj = await repos.productPrices.findActiveByProductId(prod.id);
          if (pObj && pObj.active) {
            activePriceVal = pObj.price;
          }
        } else if (!repos && prod.price && prod.price > 0) {
          activePriceVal = prod.price;
        }

        if (activePriceVal === null || activePriceVal <= 0) {
          const res = await this.formatAndRecordHandoff(
            {
              replyText: MASTER_RESPONSES_UZ.unknownPrice(prod.name),
              language: lang,
              intent: 'product_price',
              confidence: 0.5,
              needsHandoff: true,
              handoffReason: 'MISSING_ACTIVE_PRICE',
              leadSignals: { productNeed: prod.name },
              usedKnowledgeIds: [],
            },
            context,
            repos
          );
          return this.enforceActionHonesty(res, options?.actionExecuted, templates);
        }

        // Active validated price
        const priceReply = asksCash
          ? MASTER_RESPONSES_UZ.priceCashOnly(prod.name, activePriceVal)
          : MASTER_RESPONSES_UZ.priceTransferOnly(prod.name, activePriceVal);
        return this.enforceActionHonesty(
          {
            replyText: priceReply,
            language: lang,
            intent: 'product_price',
            confidence: 0.98,
            needsHandoff: false,
            leadSignals: { productNeed: prod.name },
            usedKnowledgeIds: [],
          },
          options?.actionExecuted,
          templates
        );
      } else {
        // Price/stock asked for unmatched product -> Zero Hallucination Handoff
        const res = await this.formatAndRecordHandoff(
          {
            replyText: `${templates.unknownPrice()} ${templates.askProductOrCode()}`,
            language: lang,
            intent: 'product_price',
            confidence: 0.2,
            needsHandoff: true,
            handoffReason: 'NO_RELIABLE_KNOWLEDGE',
            leadSignals: {},
            usedKnowledgeIds: [],
          },
          context,
          repos
        );
        return this.enforceActionHonesty(res, options?.actionExecuted, templates);
      }
    }

    // 5. Approved Knowledge Base Retrieval (Priority 2 — Real pgvector search)
    let approvedKnowledgeSnippets: KnowledgeSnippet[] = [];
    let retrievalMode: 'pgvector' | 'memory-lexical' | 'none' = 'none';

    if (repos && repos.knowledge) {
      const isPg = Boolean(
        repos.knowledge.constructor &&
        (repos.knowledge.constructor.name === 'PgKnowledgeRepository' ||
         repos.knowledge.constructor.name.startsWith('Pg'))
      );

      try {
        const [queryEmbedding] = await this.embeddingProvider.embed([prompt]);

        if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length === 1536) {
          const searchResults = await repos.knowledge.searchSimilar(queryEmbedding, {
            language: lang,
            topK: 5,
            minScore: 0.6,
            now: new Date(),
          });

          retrievalMode = isPg ? 'pgvector' : 'memory-lexical';
          approvedKnowledgeSnippets = searchResults.map((r) => ({
            id: r.knowledgeItemId,
            title: r.title,
            content: r.content,
            score: r.score,
            source: r.source,
          }));
        }
      } catch (_err: unknown) {
        if (isPg) {
          // STRICT RULE: If PostgreSQL vector search fails, DO NOT fallback to lexical! Safe manager handoff
          const res = await this.formatAndRecordHandoff(
            {
              replyText: templates.unknownPrice(),
              language: lang,
              intent: 'knowledge_inquiry',
              confidence: 0.2,
              needsHandoff: true,
              handoffReason: 'NO_RELIABLE_KNOWLEDGE',
              leadSignals: {},
              usedKnowledgeIds: [],
            },
            context,
            repos
          );
          return this.enforceActionHonesty(res, options?.actionExecuted, templates);
        }
      }
    }

    const usedKnowledgeIds = approvedKnowledgeSnippets.map((s) => s.id);

    // 6. Build Immutable Enriched Context for AI Provider
    const enrichedContext: AIContext = {
      ...context,
      availableProducts: activeProducts,
      approvedKnowledgeItems: approvedKnowledgeSnippets,
      knowledgeSnippets: approvedKnowledgeSnippets,
      structuredBusinessFacts: structuredFacts,
      ragSources: approvedKnowledgeSnippets.map((s) => s.source || s.id),
      retrievalMode,
    };

    // If query requires domain knowledge and nothing was retrieved -> handoff
    if (approvedKnowledgeSnippets.length === 0) {
      if (lowerPrompt.includes('limax') || lowerPrompt.includes('siyosat') || lowerPrompt.includes('sertifikat') || lowerPrompt.includes('shartnoma')) {
        const res = await this.formatAndRecordHandoff(
          {
            replyText: templates.unknownPrice(),
            language: lang,
            intent: 'knowledge_inquiry',
            confidence: 0.3,
            needsHandoff: true,
            handoffReason: 'NO_RELIABLE_KNOWLEDGE',
            leadSignals: {},
            usedKnowledgeIds: [],
          },
          context,
          repos
        );
        return this.enforceActionHonesty(res, options?.actionExecuted, templates);
      }
    }

    // 7. Mode Check: If mock mode -> use MockAdapter with Enriched Context
    if (this.aiMode === 'mock') {
      const mockAdapter = new MockAIProviderAdapter();
      const raw = await mockAdapter.generateStructuredResponse(prompt, enrichedContext);
      const processed = await this.applyPostProcessing(
        { ...raw.result, usedKnowledgeIds: raw.result.usedKnowledgeIds?.length ? raw.result.usedKnowledgeIds : usedKnowledgeIds },
        prompt,
        enrichedContext,
        repos
      );
      return this.enforceActionHonesty(processed, options?.actionExecuted, templates);
    }

    // 8. Real Provider Execution with Enriched Context & Fallback
    let fallbackUsed = false;
    let selectedAdapter = this.primaryAdapter;
    if (!selectedAdapter.isConfigured()) {
      selectedAdapter = this.fallbackAdapter;
      fallbackUsed = true;
    }

    try {
      const raw = await selectedAdapter.generateStructuredResponse(prompt, enrichedContext, { timeoutMs: this.timeoutMs });

      if (repos) {
        await repos.aiUsage.create({
          provider: selectedAdapter.providerName,
          model: process.env.OPENAI_MODEL || 'default',
          inputTokens: raw.inputTokens,
          outputTokens: raw.outputTokens,
          estimatedCost: (raw.inputTokens * 0.000005) + (raw.outputTokens * 0.000015),
          latencyMs: raw.latencyMs,
          status: 'SUCCESS',
          fallbackUsed,
        });
      }

      const guardedResult = this.guardStructuredFacts(raw.result, structuredFacts, templates);
      const processed = await this.applyPostProcessing(
        { ...guardedResult, usedKnowledgeIds: guardedResult.usedKnowledgeIds?.length ? guardedResult.usedKnowledgeIds : usedKnowledgeIds },
        prompt,
        enrichedContext,
        repos
      );
      return this.enforceActionHonesty(processed, options?.actionExecuted, templates);
    } catch {
      if (!fallbackUsed && this.fallbackAdapter.isConfigured()) {
        try {
          const fallbackRaw = await this.fallbackAdapter.generateStructuredResponse(prompt, enrichedContext, { timeoutMs: this.timeoutMs });

          if (repos) {
            await repos.aiUsage.create({
              provider: this.fallbackAdapter.providerName,
              model: process.env.GEMINI_MODEL || 'default',
              inputTokens: fallbackRaw.inputTokens,
              outputTokens: fallbackRaw.outputTokens,
              estimatedCost: 0,
              latencyMs: fallbackRaw.latencyMs,
              status: 'FALLBACK',
              fallbackUsed: true,
            });
          }

          const guardedResult = this.guardStructuredFacts(fallbackRaw.result, structuredFacts, templates);
          const processed = await this.applyPostProcessing(
            { ...guardedResult, usedKnowledgeIds: guardedResult.usedKnowledgeIds?.length ? guardedResult.usedKnowledgeIds : usedKnowledgeIds },
            prompt,
            enrichedContext,
            repos
          );
          return this.enforceActionHonesty(processed, options?.actionExecuted, templates);
        } catch {
          // Fallback failed
        }
      }

      const res = await this.formatAndRecordHandoff(
        {
          replyText: templates.securityBlocked(),
          language: lang,
          intent: 'provider_failure',
          confidence: 0.0,
          needsHandoff: true,
          handoffReason: 'FALLBACK_FAILED',
          leadSignals: {},
          usedKnowledgeIds: [],
        },
        context,
        repos
      );
      return this.enforceActionHonesty(res, options?.actionExecuted, templates);
    }
  }

  private async assembleStructuredFacts(
    repos: Repositories | undefined,
    activeProducts: Product[]
  ): Promise<StructuredBusinessFacts> {
    if (!repos) {
      return {
        products: activeProducts.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          category: p.category,
          description: p.description,
          activePrice: null,
          inventory: null,
        })),
        salesSettings: null,
      };
    }

    const productFacts: StructuredProductFact[] = [];

    for (const p of activeProducts) {
      let activePrice: StructuredProductFact['activePrice'] = null;
      let inventory: StructuredProductFact['inventory'] = null;

      try {
        const pObj = await repos.productPrices.findActiveByProductId(p.id);
        if (pObj && pObj.active) {
          activePrice = {
            amount: pObj.price,
            currency: pObj.currency,
            unit: pObj.unit,
            minimumQuantity: pObj.minimumQuantity,
            validFrom: pObj.validFrom ? new Date(pObj.validFrom).toISOString() : new Date().toISOString(),
            validUntil: pObj.validUntil ? new Date(pObj.validUntil).toISOString() : undefined,
          };
        }
      } catch {
        activePrice = null;
      }

      try {
        const invObj = await repos.productInventory.findByProductId(p.id);
        if (invObj) {
          const isUnknown = invObj.status === 'UNKNOWN' || invObj.availableQuantity === null || typeof invObj.availableQuantity !== 'number';
          if (isUnknown) {
            inventory = {
              availableQuantity: null,
              reservedQuantity: null,
              netAvailable: null,
              status: 'UNKNOWN',
              warehouse: invObj.warehouse || null,
            };
          } else {
            const avail = invObj.availableQuantity;
            const res = invObj.reservedQuantity ?? 0;
            const net = Math.max(0, avail - res);
            const status = net <= 0 || invObj.status === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'IN_STOCK';

            inventory = {
              availableQuantity: avail,
              reservedQuantity: res,
              netAvailable: net,
              status,
              warehouse: invObj.warehouse || null,
            };
          }
        }
      } catch {
        inventory = null;
      }

      productFacts.push({
        id: p.id,
        name: p.name,
        code: p.code,
        category: p.category,
        description: p.description,
        activePrice,
        inventory,
      });
    }

    let salesSettings = null;
    try {
      if (repos.salesSettings) {
        salesSettings = await repos.salesSettings.getSettings();
      }
    } catch {
      salesSettings = null;
    }

    return {
      products: productFacts,
      salesSettings,
    };
  }

  private guardStructuredFacts(
    result: AIStructuredResult,
    facts: StructuredBusinessFacts,
    templates: ReturnType<typeof getTemplates>
  ): AIStructuredResult {
    // If LLM hallucinates prices or available stock for products where DB has UNKNOWN or OUT_OF_STOCK
    const replyLower = result.replyText.toLowerCase();

    // Master rule: active products are always presented as available; inventory is not customer-facing.
    for (const p of facts.products) {
      // Check if price is unconfirmed but LLM gave a specific price
      if (!p.activePrice && (replyLower.includes(p.name.toLowerCase()) || (p.code && replyLower.includes(p.code.toLowerCase())))) {
        if (result.intent === 'product_price' && /\d+(\.\d+)?\s*(usd|\$|so'm|сум)/i.test(result.replyText)) {
          return {
            ...result,
            replyText: MASTER_RESPONSES_UZ.unknownPrice(p.name),
            needsHandoff: true,
            handoffReason: 'POST_GUARD_UNCONFIRMED_PRICE_OVERRIDE',
          };
        }
      }
    }

    return result;
  }

  private enforceActionHonesty(
    result: AIStructuredResult & { suppressAutoReply?: boolean },
    actionExecuted: boolean | undefined,
    templates: ReturnType<typeof getTemplates>
  ): AIStructuredResult & { suppressAutoReply?: boolean } {
    const protectedRegex = /(tekshiraman|aniqlab beraman|yuboraman|проверю|отправлю)/i;
    if (!actionExecuted && protectedRegex.test(result.replyText)) {
      const sanitizedReply = result.replyText.replace(protectedRegex, templates.actionNeutralFallback());
      return {
        ...result,
        replyText: sanitizedReply,
      };
    }
    return result;
  }

  private async formatAndRecordHandoff(
    result: AIStructuredResult,
    context: AIContext,
    repos?: Repositories,
    priority: 'low' | 'medium' | 'high' | 'urgent' = 'high'
  ): Promise<AIStructuredResult & { suppressAutoReply?: boolean }> {
    if (context.conversationId && repos) {
      const conv = await repos.conversations.findById(context.conversationId);
      const customerId = context.customerId || conv?.customerId;

      if (customerId) {
        const existingHandoffs = await repos.handoffs.findByConversationId(context.conversationId);
        const pendingHandoff = existingHandoffs.find((h) => h.status === 'PENDING');

        if (!pendingHandoff) {
          await repos.handoffs.create({
            conversationId: context.conversationId,
            customerId,
            reason: result.handoffReason || 'AUTO_HANDOFF',
            priority,
            status: 'PENDING',
            notes: `Auto handoff triggered for intent ${result.intent}`,
          });
        }

        await repos.conversations.update(context.conversationId, { status: 'WAITING_MANAGER' });
      }

      return {
        ...result,
        needsHandoff: true,
        suppressAutoReply: true,
      };
    }

    return {
      ...result,
      needsHandoff: true,
    };
  }

  private async applyPostProcessing(
    result: AIStructuredResult,
    prompt: string,
    context: AIContext,
    repos?: Repositories
  ): Promise<AIStructuredResult & { suppressAutoReply?: boolean }> {
    const lower = prompt.toLowerCase();
    const isLargeOrder = lower.includes('3 tonna') || lower.includes('30 tonna') || lower.includes('export');

    const scoreResult = calculateLeadScore({
      needMatchScore: isLargeOrder ? 25 : result.leadSignals.productNeed ? 20 : 0,
      timelineScore: isLargeOrder ? 20 : result.leadSignals.purchaseTime ? 15 : 0,
      budgetScore: isLargeOrder ? 15 : result.leadSignals.budget ? 10 : 0,
      authorityScore: isLargeOrder ? 10 : result.leadSignals.authority ? 10 : 0,
      activityScore: 10,
      regionScore: 10,
      contactScore: 10,
    });

    const needsHandoff =
      result.needsHandoff ||
      result.confidence < this.confidenceThreshold ||
      scoreResult.recommendHandoff;

    if (needsHandoff) {
      return this.formatAndRecordHandoff(
        {
          ...result,
          needsHandoff: true,
          handoffReason: result.handoffReason || `LEAD_SCORE_${scoreResult.temperature}`,
        },
        context,
        repos,
        scoreResult.temperature === 'HOT' ? 'urgent' : 'high'
      );
    }

    return result;
  }
}
