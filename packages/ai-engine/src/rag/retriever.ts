import type { KnowledgeItem, SupportedLanguage } from '@limax/shared';

export interface RetrievalOptions {
  language?: SupportedLanguage;
  topK?: number;
  minScore?: number;
}

export interface RetrievalResult {
  item: KnowledgeItem;
  score: number;
}

export class KnowledgeRetriever {
  constructor(private availableKnowledgeItems: KnowledgeItem[]) {}

  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievalResult[]> {
    const topK = options?.topK || 5;
    const minScore = options?.minScore || 0.6;
    const now = new Date();
    const queryLower = query.toLowerCase();

    // Filter approved and valid items
    const validItems = this.availableKnowledgeItems.filter((item) => {
      // Must be APPROVED
      if (item.status !== 'APPROVED') return false;

      // Must not be expired (if validUntil set)
      if (item.validUntil && new Date(item.validUntil) < now) return false;

      // Match language if specified
      if (options?.language && item.language !== options.language) return false;

      return true;
    });

    const scored: RetrievalResult[] = [];

    for (const item of validItems) {
      const contentLower = item.content.toLowerCase();
      const titleLower = item.title.toLowerCase();

      let score = 0;
      if (titleLower.includes(queryLower) || queryLower.includes(titleLower)) {
        score += 0.8;
      }
      const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
      let wordMatches = 0;
      for (const word of words) {
        if (contentLower.includes(word)) wordMatches++;
      }
      if (words.length > 0) {
        score += (wordMatches / words.length) * 0.5;
      }

      if (score >= minScore) {
        scored.push({ item, score: Math.min(1.0, score) });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
