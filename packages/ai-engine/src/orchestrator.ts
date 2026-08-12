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

export interface AIOrchestratorConfig {
  aiMode?: 'mock' | 'real';
  primaryProviderName?: 'openai' | 'gemini' | 'claude' | 'mock';
  fallbackProviderName?: 'openai' | 'gemini' | 'claude' | 'mock';
  timeoutMs?: number;
  confidenceThreshold?: number;
  repos?: Repositories;
}

export class AIOrchestrator {
  private aiMode: 'mock' | 'real';
  private primaryAdapter: IAIProviderAdapter;
  private fallbackAdapter: IAIProviderAdapter;
  private timeoutMs: number;
  private confidenceThreshold: number;
  private repos?: Repositories;

  constructor(config?: AIOrchestratorConfig) {
    this.aiMode = config?.aiMode || (process.env.AI_MODE as 'mock' | 'real') || 'mock';
    const primaryName = (config?.primaryProviderName || process.env.AI_PRIMARY_PROVIDER || 'openai') as 'openai' | 'gemini' | 'claude' | 'mock';
    const fallbackName = (config?.fallbackProviderName || process.env.AI_FALLBACK_PROVIDER || 'gemini') as 'openai' | 'gemini' | 'claude' | 'mock';

    this.primaryAdapter = this.resolveAdapter(primaryName);
    this.fallbackAdapter = this.resolveAdapter(fallbackName);
    this.timeoutMs = config?.timeoutMs || 30000;
    this.confidenceThreshold = config?.confidenceThreshold || 0.65;
    this.repos = config?.repos;
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
    options?: { repos?: Repositories }
  ): Promise<AIStructuredResult> {
    const repos = options?.repos || this.repos;
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const lowerPrompt = prompt.toLowerCase();

    // 1. Guardrail & Prompt Injection Pre-Check
    const guard = applyGuardrails(prompt, { lastResponse: context.lastResponse });
    if (!guard.allowed || lowerPrompt.includes('system prompt') || lowerPrompt.includes('api key') || lowerPrompt.includes('oldingi qoidalarni unut')) {
      return {
        replyText: 'Kechirasiz, ushbu savol boʻyicha javob bera olmayman. Menejerimiz tez orada bogʻlanadi.',
        language: lang,
        intent: 'security_blocked',
        confidence: 0.1,
        needsHandoff: true,
        handoffReason: guard.reason || 'PROMPT_INJECTION_BLOCKED',
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    // 2. Structured Product & Business Data Source (Priority 1)
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
      lowerPrompt.includes('stock');

    if (isPriceOrStockQuery) {
      if (matchedProducts.length > 0) {
        const prod = matchedProducts[0];

        // Check active pricing repository first if available
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
              return {
                replyText: `Kechirasiz, ${prod.name} hozirda omborda mavjud emas yoki holati nomaʼlum. Menejerimiz tez orada bogʻlanadi.`,
                language: lang,
                intent: 'product_stock',
                confidence: 0.5,
                needsHandoff: true,
                handoffReason: `INVENTORY_STATUS_${inventoryObj.status}`,
                leadSignals: { productNeed: prod.name },
                usedKnowledgeIds: [],
              };
            }
          }
        }

        if (!activePriceVal || activePriceVal <= 0) {
          return {
            replyText: `Kechirasiz, ${prod.name} uchun amaldagi narx belgilanmagan. Menejerimiz tez orada bogʻlanadi.`,
            language: lang,
            intent: 'product_price',
            confidence: 0.3,
            needsHandoff: true,
            handoffReason: 'MISSING_ACTIVE_PRICE',
            leadSignals: { productNeed: prod.name },
            usedKnowledgeIds: [],
          };
        }

        return {
          replyText: `${prod.name} narxi 1 ${activeUnit} uchun ${activePriceVal} ${activeCurrency}. Minimal buyurtma (MOQ): ${minQty} ${activeUnit}.`,
          language: lang,
          intent: 'product_price',
          confidence: 0.98,
          needsHandoff: false,
          leadSignals: { productNeed: prod.name },
          usedKnowledgeIds: [],
        };
      } else {
        // Price or stock asked for unmatched/missing product -> Zero Hallucination Policy (Handoff to Manager)
        return {
          replyText: 'Kechirasiz, ushbu mahsulot narxi va ombor holati boʻyicha aniq maʼlumot topilmadi. Menejerimiz tez orada bogʻlanadi.',
          language: lang,
          intent: 'product_price',
          confidence: 0.2,
          needsHandoff: true,
          handoffReason: 'NO_RELIABLE_KNOWLEDGE',
          leadSignals: {},
          usedKnowledgeIds: [],
        };
      }
    }

    // 3. Approved Knowledge Base (Priority 2)
    let knowledgeItems: KnowledgeItem[] = [];
    if (repos) {
      const allKB = await repos.knowledge.findAll({});
      const now = new Date();
      // Filter APPROVED status & non-expired validUntil only
      knowledgeItems = allKB.filter(
        (k) => k.status === 'APPROVED' && (!k.validUntil || new Date(k.validUntil) > now)
      );
    }
    const retriever = new KnowledgeRetriever(knowledgeItems);
    const ragResults = await retriever.retrieve(prompt, { language: lang, minScore: 0.6 });

    if (knowledgeItems.length === 0 || ragResults.length === 0) {
      if (lowerPrompt.includes('limax') || lowerPrompt.includes('siyosat') || lowerPrompt.includes('sertifikat')) {
        return {
          replyText: 'Kechirasiz, tasdiqlangan kompaniya bilimlari bazasida ushbu maʼlumot topilmadi. Menejerimiz tez orada bogʻlanadi.',
          language: lang,
          intent: 'knowledge_inquiry',
          confidence: 0.3,
          needsHandoff: true,
          handoffReason: 'NO_RELIABLE_KNOWLEDGE',
          leadSignals: {},
          usedKnowledgeIds: [],
        };
      }
    }

    // 4. Mode Check: If mock mode -> use MockAdapter
    if (this.aiMode === 'mock') {
      const mockAdapter = new MockAIProviderAdapter();
      const raw = await mockAdapter.generateStructuredResponse(prompt, { ...context, availableProducts: activeProducts });
      return this.applyPostProcessing(raw.result, prompt, repos);
    }

    // 5. Real Provider Execution with Fallback
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

      return this.applyPostProcessing(raw.result, prompt, repos);
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

          return this.applyPostProcessing(fallbackRaw.result, prompt, repos);
        } catch {
          // Fallback failed
        }
      }

      return {
        replyText: 'Kechirasiz, tizimda vaqtincha uzilish yuz berdi. Menejerimiz tez orada bogʻlanadi.',
        language: lang,
        intent: 'provider_failure',
        confidence: 0.0,
        needsHandoff: true,
        handoffReason: 'FALLBACK_FAILED',
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }
  }

  private applyPostProcessing(
    result: AIStructuredResult,
    _prompt: string,
    _repos?: Repositories
  ): AIStructuredResult {
    const scoreResult = calculateLeadScore({
      needMatchScore: result.leadSignals.productNeed ? 25 : 0,
      timelineScore: result.leadSignals.purchaseTime ? 20 : 0,
      budgetScore: result.leadSignals.budget ? 15 : 0,
      authorityScore: result.leadSignals.authority ? 10 : 0,
      activityScore: 10,
      regionScore: 10,
      contactScore: 10,
    });

    const needsHandoff =
      result.needsHandoff ||
      result.confidence < this.confidenceThreshold ||
      scoreResult.recommendHandoff;

    return {
      ...result,
      needsHandoff,
      handoffReason: result.handoffReason || (scoreResult.recommendHandoff ? `LEAD_SCORE_${scoreResult.temperature}` : undefined),
    };
  }
}
