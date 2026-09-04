import type { Product, SupportedLanguage } from '@limax/shared';

// ==========================================
// AI Interfaces & Types
// ==========================================

export interface AIContext {
  customerId?: string;
  customerName?: string;
  preferredLanguage?: SupportedLanguage;
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  availableProducts?: Product[];
  knowledgeSnippets?: string[];
  lastResponse?: string;
}

export interface AIResponse {
  content: string;
  confidenceScore: number;
  detectedLanguage: SupportedLanguage;
  suggestedAction?: 'reply' | 'handoff' | 'wait';
  handoffReason?: string;
}

export interface IntentResult {
  intent: 'product_inquiry' | 'price_request' | 'support' | 'purchase_intent' | 'general' | 'unknown';
  confidence: number;
}

export interface ExtractedLeadData {
  needMatchScore: number; // 0..25
  timelineScore: number; // 0..20
  budgetScore: number; // 0..15
  authorityScore: number; // 0..10
  activityScore: number; // 0..10
  regionScore: number; // 0..10
  contactScore: number; // 0..10
  estimatedValue?: number;
  productInterest?: string;
}

export interface AIProvider {
  generateResponse(prompt: string, context: AIContext): Promise<AIResponse>;
  classifyIntent(message: string): Promise<IntentResult>;
  summarizeConversation(messages: string[]): Promise<string>;
  extractLeadData(message: string): Promise<ExtractedLeadData>;
}

// ==========================================
// Language Detector
// ==========================================

export function detectLanguage(text: string): SupportedLanguage {
  const lower = text.toLowerCase();

  // Chinese characters
  if (/[\u4e00-\u9fa5]/.test(text)) {
    return 'zh';
  }

  // Cyrillic script checking (ru, uz-Cyrl, tg, kk, ky)
  if (/[\u0400-\u04FF]/.test(text)) {
    // Kazakh specific unique characters or words
    if (/[әұі]/i.test(lower) || /(сәлем|бағасы)/i.test(lower)) {
      return 'kk';
    }
    // Kyrgyz specific unique characters or words
    if (/(салам|баасы|канча)/i.test(lower)) {
      return 'ky';
    }
    // Tajiki specific unique characters or words (чанд, чихел, ӣ, ӯ, ҷ)
    if (/[ӣӯҷ]/i.test(lower) || /(чанд|чихел|сомонӣ)/i.test(lower)) {
      return 'tg';
    }
    // Uzbek Cyrillic specific characters (ў, қ, ғ, ҳ) or Uzbek words in Cyrillic
    if (/[ўқғҳ]/i.test(lower) || /(салом|раҳмат|рахмат|қанша|қанча|нархи|полиэстер|иплар|кимсан|сен|сиз|борми|мисан)/i.test(lower)) {
      return 'uz-Cyrl';
    }
    // Russian default for Cyrillic
    return 'ru';
  }

  // English indicators
  if (/\b(hello|hi|price|cost|buy|order|catalog|product|how much)\b/i.test(lower) && !/(salom|rahmat|yuboring|narxi|ip)/i.test(lower)) {
    return 'en';
  }

  // Default Uzbek Latin
  return 'uz';
}

// ==========================================
// Lead Scoring Engine
// ==========================================

export interface LeadScoreResult {
  score: number; // 0-100
  temperature: 'COLD' | 'WARM' | 'HOT';
  recommendHandoff: boolean;
  breakdown: {
    needMatch: number;
    timeline: number;
    budget: number;
    authority: number;
    activity: number;
    region: number;
    contact: number;
  };
}

export function calculateLeadScore(data: ExtractedLeadData): LeadScoreResult {
  const needMatch = Math.min(25, Math.max(0, data.needMatchScore || 0));
  const timeline = Math.min(20, Math.max(0, data.timelineScore || 0));
  const budget = Math.min(15, Math.max(0, data.budgetScore || 0));
  const authority = Math.min(10, Math.max(0, data.authorityScore || 0));
  const activity = Math.min(10, Math.max(0, data.activityScore || 0));
  const region = Math.min(10, Math.max(0, data.regionScore || 0));
  const contact = Math.min(10, Math.max(0, data.contactScore || 0));

  const totalScore = needMatch + timeline + budget + authority + activity + region + contact;

  let temperature: 'COLD' | 'WARM' | 'HOT' = 'COLD';
  if (totalScore >= 75) {
    temperature = 'HOT';
  } else if (totalScore >= 50) {
    temperature = 'WARM';
  }

  return {
    score: totalScore,
    temperature,
    recommendHandoff: temperature === 'HOT',
    breakdown: {
      needMatch,
      timeline,
      budget,
      authority,
      activity,
      region,
      contact,
    },
  };
}

// ==========================================
// Product Matcher
// ==========================================

export function matchProducts(query: string, availableProducts: Product[]): Product[] {
  const cleanQuery = query.toLowerCase().replace(/[^\w\s/]/g, ' ');
  const words = cleanQuery.split(/\s+/).filter((w) => w.length >= 2);
  const stopWords = new Set([
    'narxi', 'narx', 'qancha', 'price', 'cost', 'moq', 'ombor', 'stock', 'yoki', 'va',
    'bormi', 'bor', 'nech', 'pul', 'ip', 'iplar', 'mahsulot', 'noma’lum', 'nomalum',
    'test', 'stage15', 'test_stage15'
  ]);

  const scored: Array<{ product: Product; score: number }> = [];

  for (const product of availableProducts) {
    const nameLower = product.name ? product.name.toLowerCase() : '';
    const categoryLower = product.category ? product.category.toLowerCase() : '';
    const descLower = product.description ? product.description.toLowerCase() : '';
    const codeLower = product.code ? product.code.toLowerCase() : '';

    let score = 0;
    if (codeLower && cleanQuery.includes(codeLower)) score += 10;
    if (nameLower && cleanQuery.includes(nameLower)) score += 8;

    for (const w of words) {
      if (!stopWords.has(w)) {
        if (nameLower && nameLower.includes(w)) score += 3;
        if (codeLower && codeLower.includes(w)) score += 3;
        if (categoryLower && categoryLower.includes(w)) score += 1;
        if (descLower && descLower.includes(w)) score += 1;
      }
    }

    if (score > 0) {
      scored.push({ product, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];
  const topScore = scored[0].score;
  if (scored.length > 1 && topScore > scored[1].score) {
    return [scored[0].product];
  }

  return scored.filter((s) => s.score === topScore).map((s) => s.product);
}

// ==========================================
// Guardrails Engine
// ==========================================

export interface GuardrailCheckResult {
  allowed: boolean;
  reason?: string;
  sanitizedContent?: string;
  triggerHandoff?: boolean;
}

export function applyGuardrails(
  content: string,
  context?: { lastResponse?: string; confidenceScore?: number }
): GuardrailCheckResult {
  const lower = content.toLowerCase();

  // 1. Forbidden Topics (Religion & Politics)
  const forbiddenKeywords = [
    'diniy', 'siyosiy', 'namoz', 'masjid', 'saylov', 'prezident', 'partiya',
    'религия', 'политика', 'выборы', 'президент', 'партия',
    'religion', 'politics', 'election', 'president', 'party'
  ];
  if (forbiddenKeywords.some((keyword) => lower.includes(keyword))) {
    return {
      allowed: false,
      reason: 'FORBIDDEN_TOPIC_POLITICS_RELIGION',
      triggerHandoff: true,
    };
  }

  // 1b. Complaints & Unverified Sample Requests (High Priority Handoff)
  if (/(tuklik|brak|vozvrat|sifati yaxshimi|образц|образец|obrazets|obrazes|namuna)/i.test(lower)) {
    return {
      allowed: true,
      triggerHandoff: true,
      reason: lower.includes('tuklik') || lower.includes('brak') || lower.includes('vozvrat') ? 'COMPLAINT_HANDOFF' : 'SAMPLE_UNVERIFIED_HANDOFF',
    };
  }

  // 2. Secret Redaction
  const sanitized = content.replace(
    /\b(sk-[a-zA-Z0-9]{20,}|bearer\s+[a-zA-Z0-9\._\-]+|password\s*=\s*\S+)\b/gi,
    '[REDACTED_SECRET]'
  );

  // 3. Low Confidence Handoff
  if (context?.confidenceScore !== undefined && context.confidenceScore < 0.6) {
    return {
      allowed: true,
      sanitizedContent: sanitized,
      triggerHandoff: true,
      reason: 'LOW_CONFIDENCE',
    };
  }

  // 4. Duplicate Response Prevention
  if (context?.lastResponse && context.lastResponse.trim() === sanitized.trim()) {
    return {
      allowed: false,
      reason: 'DUPLICATE_RESPONSE_PREVENTED',
      triggerHandoff: true,
    };
  }

  return {
    allowed: true,
    sanitizedContent: sanitized,
    triggerHandoff: false,
  };
}

// ==========================================
// Mock AI Provider (For Offline Unit Tests)
// ==========================================

export class MockAIProvider implements AIProvider {
  async generateResponse(prompt: string, context: AIContext): Promise<AIResponse> {
    const lang = context.preferredLanguage || detectLanguage(prompt);
    const guard = applyGuardrails(prompt, { lastResponse: context.lastResponse });

    if (!guard.allowed) {
      return {
        content: 'Kechirasiz, ushbu savol boʻyicha javob bera olmayman. Menejerimiz tez orada bogʻlanadi.',
        confidenceScore: 0.2,
        detectedLanguage: lang,
        suggestedAction: 'handoff',
        handoffReason: guard.reason,
      };
    }

    if (prompt.toLowerCase().includes('narxi') || prompt.toLowerCase().includes('price')) {
      if (context.availableProducts && context.availableProducts.length > 0) {
        const p = context.availableProducts[0];
        return {
          content: `${p.name} narxi ${p.price} ${p.currency}.`,
          confidenceScore: 0.95,
          detectedLanguage: lang,
          suggestedAction: 'reply',
        };
      }
    }

    return {
      content: `Assalomu alaykum! Sizga qanday yordam bera olaman? (${lang})`,
      confidenceScore: 0.9,
      detectedLanguage: lang,
      suggestedAction: 'reply',
    };
  }

  async classifyIntent(message: string): Promise<IntentResult> {
    const lower = message.toLowerCase();
    if (lower.includes('narx') || lower.includes('price') || lower.includes('quanto')) {
      return { intent: 'price_request', confidence: 0.95 };
    }
    if (lower.includes('sotib olish') || lower.includes('buy') || lower.includes('order')) {
      return { intent: 'purchase_intent', confidence: 0.9 };
    }
    return { intent: 'general', confidence: 0.7 };
  }

  async summarizeConversation(messages: string[]): Promise<string> {
    return `Mijoz bilan ${messages.length} ta xabardan iborat suhbat xulosasi.`;
  }

  async extractLeadData(message: string): Promise<ExtractedLeadData> {
    const lower = message.toLowerCase();
    const isPurchase = lower.includes('sotib olish') || lower.includes('buy') || lower.includes('1000');
    return {
      needMatchScore: isPurchase ? 25 : 10,
      timelineScore: isPurchase ? 20 : 5,
      budgetScore: isPurchase ? 15 : 5,
      authorityScore: isPurchase ? 10 : 5,
      activityScore: 10,
      regionScore: 10,
      contactScore: 10,
      estimatedValue: isPurchase ? 5000 : 500,
    };
  }
}

// Stage 5, Stage 7 & Stage 15.1 Exports
export * from './providers/types.js';
export { OpenAIProviderAdapter } from './providers/openai.provider.js';
export { GeminiProviderAdapter } from './providers/gemini.provider.js';
export { ClaudeProviderAdapter } from './providers/claude.provider.js';
export { MockAIProviderAdapter } from './providers/mock.provider.js';
export * from './embeddings/types.js';
export { MockEmbeddingProvider } from './embeddings/mock.embedding.js';
export { OpenAIEmbeddingProvider } from './embeddings/openai.embedding.js';
export { GeminiEmbeddingProvider } from './embeddings/gemini.embedding.js';
export { createEmbeddingProvider } from './embeddings/factory.js';
export { chunkKnowledgeContent } from './rag/chunker.js';
export { KnowledgeRetriever } from './rag/retriever.js';
export * from './rag/index-audit.js';
export { AIOrchestrator } from './orchestrator.js';
export * from './behavior.schema.js';
export * from './localization/templates.js';
export * from './prompts/index.js';
export * from './templates/index.js';

