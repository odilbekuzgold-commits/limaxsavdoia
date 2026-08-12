import type { AIContext, AIStructuredResult } from '@limax/shared';
import { detectLanguage } from '../index.js';
import type { IAIProviderAdapter, ProviderRequestOptions, ProviderRawResponse } from './types.js';

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

    let result: AIStructuredResult;

    // Check for prompt injection / secret leakage attempts
    if (
      lower.includes('system prompt') ||
      lower.includes('api key') ||
      lower.includes('oldingi qoidalarni unut') ||
      lower.includes('secret')
    ) {
      result = {
        replyText: 'Kechirasiz, xavfsizlik va ichki tizim maʼlumotlarini ochiqlay olmayman.',
        language: lang,
        intent: 'prompt_injection_blocked',
        confidence: 0.1,
        needsHandoff: true,
        handoffReason: 'PROMPT_INJECTION_DETECTED',
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    } else if (lower.includes('narxi') || lower.includes('price')) {
      if (context.availableProducts && context.availableProducts.length > 0) {
        const p = context.availableProducts[0];
        result = {
          replyText: `${p.name} narxi ${p.price} ${p.currency}. Minimal buyurtma: ${p.minimumOrder || 1} kg.`,
          language: lang,
          intent: 'product_price',
          confidence: 0.95,
          needsHandoff: false,
          leadSignals: { productNeed: p.name },
          usedKnowledgeIds: [],
        };
      } else {
        result = {
          replyText: 'Kechirasiz, ushbu mahsulot narxi va maʼlumotlari boʻyicha aniq axborot yoʻq. Menejerimiz tez orada bogʻlanadi.',
          language: lang,
          intent: 'product_price',
          confidence: 0.3,
          needsHandoff: true,
          handoffReason: 'NO_RELIABLE_KNOWLEDGE',
          leadSignals: {},
          usedKnowledgeIds: [],
        };
      }
    } else {
      result = {
        replyText: `Assalomu alaykum! LImax Yarn B2B xizmatiga xush kelibsiz. Sizga qanday yordam bera olaman?`,
        language: lang,
        intent: 'general_inquiry',
        confidence: 0.9,
        needsHandoff: false,
        leadSignals: {},
        usedKnowledgeIds: [],
      };
    }

    const latencyMs = Date.now() - startTime;
    return {
      result,
      inputTokens: 50,
      outputTokens: 50,
      latencyMs,
    };
  }
}
