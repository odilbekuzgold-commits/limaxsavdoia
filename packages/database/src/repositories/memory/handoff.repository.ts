import { randomUUID } from 'crypto';
import type { Handoff, IHandoffRepository } from '@limax/shared';

export class InMemoryHandoffRepository implements IHandoffRepository {
  private db: Map<string, Handoff> = new Map();

  async findByConversationId(conversationId: string): Promise<Handoff[]> {
    return Array.from(this.db.values()).filter((h) => h.conversationId === conversationId);
  }

  async findById(id: string): Promise<Handoff | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: Omit<Handoff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Handoff> {
    const now = new Date();
    const handoff: Handoff = { ...data, status: data.status || 'PENDING', id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.set(handoff.id, handoff);
    return handoff;
  }

  async update(id: string, data: Partial<Handoff>): Promise<Handoff | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Handoff = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }
}
