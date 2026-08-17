import { randomUUID } from 'crypto';
import type {
  KnowledgeItem,
  CreateKnowledgeItem,
  SupportedLanguage,
  KnowledgeStatus,
  IKnowledgeRepository,
  KnowledgeSearchResult,
} from '@limax/shared';

interface StoredChunk {
  id: string;
  knowledgeItemId: string;
  chunkIndex: number;
  content: string;
  language: SupportedLanguage;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export class InMemoryKnowledgeRepository implements IKnowledgeRepository {
  private db: Map<string, KnowledgeItem> = new Map();
  private chunkDb: Map<string, StoredChunk[]> = new Map(); // key = knowledgeItemId

  async findAll(params: { language?: SupportedLanguage; status?: KnowledgeStatus }): Promise<KnowledgeItem[]> {
    return Array.from(this.db.values()).filter((item) => {
      const langMatch = params.language ? item.language === params.language : true;
      const statusMatch = params.status ? item.status === params.status : true;
      return langMatch && statusMatch;
    });
  }

  async findById(id: string): Promise<KnowledgeItem | null> {
    return this.db.get(id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<KnowledgeItem | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: CreateKnowledgeItem): Promise<KnowledgeItem> {
    const now = new Date();
    const item: KnowledgeItem = { ...data, id: randomUUID(), status: data.status || 'DRAFT', createdAt: now, updatedAt: now };
    this.db.set(item.id, item);
    return item;
  }

  async update(id: string, data: Partial<KnowledgeItem>): Promise<KnowledgeItem | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: KnowledgeItem = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  async searchSimilar(
    embedding: number[],
    options: {
      language?: SupportedLanguage;
      topK: number;
      minScore: number;
      now: Date;
    }
  ): Promise<KnowledgeSearchResult[]> {
    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      throw new Error(`Invalid embedding dimension: expected exactly 1536 floats, got ${embedding?.length ?? 0}`);
    }

    for (let i = 0; i < embedding.length; i++) {
      if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
        throw new Error(`Invalid embedding vector element at index ${i}: must be a finite number`);
      }
    }

    const now = options.now instanceof Date ? options.now : new Date();
    const topK = Math.max(1, Math.min(10, options.topK || 5));
    const minScore = typeof options.minScore === 'number' ? options.minScore : 0.6;

    const allChunks: StoredChunk[] = [];
    for (const chunks of this.chunkDb.values()) {
      allChunks.push(...chunks);
    }

    const results: KnowledgeSearchResult[] = [];

    for (const chunk of allChunks) {
      const item = this.db.get(chunk.knowledgeItemId);
      if (!item || item.status !== 'APPROVED') continue;
      if (item.validFrom && new Date(item.validFrom) > now) continue;
      if (item.validUntil && new Date(item.validUntil) <= now) continue;
      if (options.language && item.language !== options.language) continue;

      let score = 0.85; // Default match score in memory fallback
      if (chunk.embedding && chunk.embedding.length === 1536) {
        // Calculate cosine similarity
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < 1536; i++) {
          dot += embedding[i] * chunk.embedding[i];
          normA += embedding[i] * embedding[i];
          normB += chunk.embedding[i] * chunk.embedding[i];
        }
        score = normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
      }

      if (score >= minScore) {
        results.push({
          chunkId: chunk.id,
          knowledgeItemId: item.id,
          title: item.title,
          content: chunk.content,
          language: item.language,
          source: item.source,
          score,
          metadata: chunk.metadata,
        });
      }
    }

    // If no chunks exist in memory, fall back to memory knowledge items directly for dev mode
    if (results.length === 0 && allChunks.length === 0) {
      for (const item of this.db.values()) {
        if (item.status !== 'APPROVED') continue;
        if (item.validFrom && new Date(item.validFrom) > now) continue;
        if (item.validUntil && new Date(item.validUntil) <= now) continue;
        if (options.language && item.language !== options.language) continue;

        results.push({
          chunkId: `mem-chunk-${item.id}`,
          knowledgeItemId: item.id,
          title: item.title,
          content: item.content,
          language: item.language,
          source: item.source,
          score: 0.9,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async replaceChunks(
    knowledgeItemId: string,
    chunks: Array<{
      chunkIndex: number;
      content: string;
      language?: SupportedLanguage;
      embedding?: number[];
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    const stored: StoredChunk[] = chunks.map((c) => {
      if (c.embedding && c.embedding.length !== 1536) {
        throw new Error(`Chunk embedding must be exactly 1536 dimensions, got ${c.embedding.length}`);
      }
      return {
        id: randomUUID(),
        knowledgeItemId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        language: c.language || 'uz',
        embedding: c.embedding,
        metadata: c.metadata,
      };
    });

    this.chunkDb.set(knowledgeItemId, stored);
  }

  seed(item: KnowledgeItem): void {
    this.db.set(item.id, item);
  }
}
