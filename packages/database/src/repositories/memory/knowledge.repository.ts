import { randomUUID } from 'crypto';
import type {
  KnowledgeItem,
  CreateKnowledgeItem,
  SupportedLanguage,
  KnowledgeStatus,
  IKnowledgeRepository,
} from '@limax/shared';

export class InMemoryKnowledgeRepository implements IKnowledgeRepository {
  private db: Map<string, KnowledgeItem> = new Map();

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

  async create(data: CreateKnowledgeItem): Promise<KnowledgeItem> {
    const now = new Date();
    const item: KnowledgeItem = { ...data, id: randomUUID(), status: 'DRAFT', createdAt: now, updatedAt: now };
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

  seed(item: KnowledgeItem): void {
    this.db.set(item.id, item);
  }
}
