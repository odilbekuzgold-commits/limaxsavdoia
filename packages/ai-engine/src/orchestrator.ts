import type {
  AIContext,
  AIStructuredResult,
  Product,
  KnowledgeItem,
  Repositories,
} from '@limax/shared';
import { detectLanguage, calculateLeadScore, applyGuardrails, matchProducts } from './index.js';
import type { IAIProviderAdapter } from './providers/types.js';
import { OpenAIProviderAdapter } from './providers/openai.provider.js';
import { GeminiProviderAdapter } from './providers/gemini.provider.js';
import { ClaudeProviderAdapter } from './providers/claude.provider.js';
import { MockAIProviderAdapter } from './providers/mock.provider.js';
import { KnowledgeRetriever } from './rag/retriever.js';
import { loadBehaviorV2Config, type BehaviorV2Config } from './behavior.schema.js';
import { getLocalizedTemplate } from './localization/templates.js';

export interface AIOrchestratorConfig {
  aiMode?: 'mock' | 'real';
  primaryProviderName?: 'openai' | 'gemini' | 'claude' | 'mock';
  fallbackProviderName?: 'openai' | 'gemini' | 'claude' | 'mock';
  timeoutMs?: number;
  confidenceThreshold?: number;
  repos?: Repositories;
  behaviorConfig?: BehaviorV2Config;
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

  constructor(config?: AIOrchestratorConfig) {
    this.aiMode = config?.aiMode || (process.env.AI_MODE as 'mock' | 'real') || 'mock';
    const primaryName = (config?.primaryProviderName || process.env.AI_PRIMARY_PROVIDER || 'openai') as 'openai' | 'gemini' | 'claude' | 'mock';
    const fallbackName = (config?.fallbackProviderName || process.env.AI_FALLBACK_PROVIDER || 'gemini') as 'openai' | 'gemini' | 'claude' | 'mock';

    this.primaryAdapter = this.resolveAdapter(primaryName);
    this.fallbackAdapter = this.resolveAdapter(fallbackName);
    this.timeoutMs = config?.timeoutMs || 30000;
    this.confidenceThreshold = config?.confidenceThreshold || 0.65;
    this.repos = config?.repos;
    this.behaviorConfig = config?.behaviorConfig || loadBehaviorV2Config();
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
    context: AIContext,
    options?: ProcessQueryOptions
  ): Promise<AIStructuredResult & { suppressAutoReply?: boolean }> {
    const repos = options?.repos || this.repos;
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const templates = getLocalizedTemplate(lang);
    const lowerPrompt = prompt.toLowerCase();

    // 1. Check existing WAITING_MANAGER state
    if (context.conversationId && repos) {
      const conv = await repos.conversations.findById(context.conversationId);
      if (conv && conv.status === 'WAITING_MANAGER') {
        return {
          replyText: templates.managerHandoff(),
          language: lang,
          intent: 'manager_active',
          confidence: 1.0,
          needsHandoff: true,
          handoffReason: 'CONVERSATION_WAITING_MANAGER',
          suppressAutoReply: true,
          leadSignals: {},
          usedKnowledgeIds: [],
        };
      }
    }

    // 2. Guardrail & Prompt Injection Pre-Check
    const guard = applyGuardrails(prompt, { lastResponse: context.lastResponse });
    if (!guard.allowed || lowerPrompt.includes('system prompt') || lowerPrompt.includes('api key') || lowerPrompt.includes('oldingi qoidalarni unut')) {
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

    // 3. Manager direct request
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

    // 4. Structured Product & Business Data Source (Priority 1)
    let availableProducts: Product[] = context.availableProducts || [];
    if (repos && availableProducts.length === 0) {
      availableProducts = await repos.products.findAll({});
    }

    const activeProducts = availableProducts.filter((p) => p.active !== false);
    const matchedProducts = matchProducts(prompt, activeProducts);

    const isPriceOrStockQuery =
      lowerPrompt.includes('narxi') ||
      lowerPrompt.includes('price') ||
      lowerPrompt.includes('moq') ||
      lowerPrompt.includes('ombor') ||
      lowerPrompt.includes('stock') ||
      lowerPrompt.includes('bormi') ||
      lowerPrompt.includes('борми') ||
      lowerPrompt.includes('есть') ||
      lowerPrompt.includes('почём') ||
      lowerPrompt.includes('сколько стоит');

    if (isPriceOrStockQuery) {
      if (matchedProducts.length > 0) {
        const prod = matchedProducts[0];

        let activePriceVal = prod.price;
        let activeCurrency = prod.currency || 'USD';
        let activeUnit = 'kg';
        let minQty = prod.minimumOrder || 1;

        if (repos) {
          const activePriceObj = await repos.productPrices.findActiveByProductId(prod.id);
          if (activePriceObj) {
            activePriceVal = activePriceObj.price;
            activeCurrency = activePriceObj.currency;
            activeUnit = activePriceObj.unit;
            minQty = activePriceObj.minimumQuantity;
          }

          const inventoryObj = await repos.productInventory.findByProductId(prod.id);
          if (inventoryObj) {
            if (inventoryObj.status === 'OUT_OF_STOCK' || inventoryObj.status === 'UNKNOWN') {
              const res = await this.formatAndRecordHandoff(
                {
                  replyText: templates.unknownStock(prod.name),
                  language: lang,
                  intent: 'product_stock',
                  confidence: 0.5,
                  needsHandoff: true,
                  handoffReason: `INVENTORY_STATUS_${inventoryObj.status}`,
                  leadSignals: { productNeed: prod.name },
                  usedKnowledgeIds: [],
                },
                context,
                repos
              );
              return this.enforceActionHonesty(res, options?.actionExecuted, templates);
            }
          }
        }

        if (!activePriceVal || activePriceVal <= 0) {
          const res = await this.formatAndRecordHandoff(
            {
              replyText: templates.unknownPrice(prod.name),
              language: lang,
              intent: 'product_price',
              confidence: 0.3,
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

        const reply = `${prod.name} narxi 1 ${activeUnit} uchun ${activePriceVal} ${activeCurrency}. Minimal buyurtma (MOQ): ${minQty} ${activeUnit}.`;
        return this.enforceActionHonesty(
          {
            replyText: reply,
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

    // 5. Approved Knowledge Base (Priority 2)
    let knowledgeItems: KnowledgeItem[] = [];
    if (repos) {
      const allKB = await repos.knowledge.findAll({});
      const now = new Date();
      knowledgeItems = allKB.filter(
        (k) => k.status === 'APPROVED' && (!k.validUntil || new Date(k.validUntil) > now)
      );
    }
    const retriever = new KnowledgeRetriever(knowledgeItems);
    const ragResults = await retriever.retrieve(prompt, { language: lang, minScore: 0.6 });

    if (knowledgeItems.length === 0 || ragResults.length === 0) {
      if (lowerPrompt.includes('limax') || lowerPrompt.includes('siyosat') || lowerPrompt.includes('sertifikat')) {
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

    // 6. Mode Check: If mock mode -> use MockAdapter
    if (this.aiMode === 'mock') {
      const mockAdapter = new MockAIProviderAdapter();
      const raw = await mockAdapter.generateStructuredResponse(prompt, { ...context, availableProducts: activeProducts });
      const processed = await this.applyPostProcessing(raw.result, prompt, context, repos);
      return this.enforceActionHonesty(processed, options?.actionExecuted, templates);
    }

    // 7. Real Provider Execution with Fallback
    let fallbackUsed = false;
    let selectedAdapter = this.primaryAdapter;
    if (!selectedAdapter.isConfigured()) {
      selectedAdapter = this.fallbackAdapter;
      fallbackUsed = true;
    }

    try {
      const raw = await selectedAdapter.generateStructuredResponse(prompt, context, { timeoutMs: this.timeoutMs });

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

      const processed = await this.applyPostProcessing(raw.result, prompt, context, repos);
      return this.enforceActionHonesty(processed, options?.actionExecuted, templates);
    } catch {
      if (!fallbackUsed && this.fallbackAdapter.isConfigured()) {
        try {
          const fallbackRaw = await this.fallbackAdapter.generateStructuredResponse(prompt, context, { timeoutMs: this.timeoutMs });

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

          const processed = await this.applyPostProcessing(fallbackRaw.result, prompt, context, repos);
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

  private enforceActionHonesty(
    result: AIStructuredResult & { suppressAutoReply?: boolean },
    actionExecuted: boolean | undefined,
    templates: ReturnType<typeof getLocalizedTemplate>
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
      const existingHandoffs = await repos.handoffs.findByConversationId(context.conversationId);
      const pendingHandoff = existingHandoffs.find((h) => h.status === 'PENDING');

      if (!pendingHandoff) {
        await repos.handoffs.create({
          conversationId: context.conversationId,
          customerId: context.customerId || '00000000-0000-0000-0000-000000000000',
          reason: result.handoffReason || 'AUTO_HANDOFF',
          priority,
          status: 'PENDING',
          notes: `Auto handoff triggered for intent ${result.intent}`,
        });
      }

      await repos.conversations.update(context.conversationId, { status: 'WAITING_MANAGER' });
      return {
        ...result,
        needsHandoff: true,
        suppressAutoReply: true,
      };
    }

    return result;
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
