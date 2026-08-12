import { randomUUID } from 'crypto';
import type { Conversation, IConversationRepository } from '@limax/shared';

export class InMemoryConversationRepository implements IConversationRepository {
  private db: Map<string, Conversation> = new Map();

  async findAll(params: { status?: string }): Promise<Conversation[]> {
    return Array.from(this.db.values()).filter((c) =>
      params.status ? c.status === params.status : true
    );
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation> {
    const now = new Date();
    const conv: Conversation = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.set(conv.id, conv);
    return conv;
  }

  async update(id: string, data: Partial<Conversation>): Promise<Conversation | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Conversation = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  seed(conversation: Conversation): void {
    this.db.set(conversation.id, conversation);
  }
}
