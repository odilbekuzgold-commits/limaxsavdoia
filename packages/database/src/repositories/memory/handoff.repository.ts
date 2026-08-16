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
    const handoff: Handoff = {
      ...data,
      status: data.status || 'PENDING',
      metadata: data.metadata || {},
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.db.set(handoff.id, handoff);
    return handoff;
  }

  async update(id: string, data: Partial<Handoff>): Promise<Handoff | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Handoff = {
      ...existing,
      ...data,
      metadata: data.metadata !== undefined ? data.metadata : (existing.metadata || {}),
      id: existing.id,
      updatedAt: new Date(),
    };
    this.db.set(id, updated);
    return updated;
  }

  async claimManagerNotificationDelivery(id: string, timeoutMs = 30000): Promise<boolean> {
    const existing = this.db.get(id);
    if (!existing) return false;
    const currentMeta = (existing.metadata || {}) as Record<string, unknown>;
    const status = currentMeta.managerNotificationStatus as string | undefined;
    const claimedAt = currentMeta.managerNotificationClaimedAt as string | undefined;

    const isStale =
      status === 'PROCESSING' &&
      claimedAt &&
      Date.now() - new Date(claimedAt).getTime() > timeoutMs;

    const canClaim =
      !status ||
      status === 'PENDING' ||
      status === 'FAILED' ||
      status === 'NOT_SENT' ||
      isStale;

    if (!canClaim) return false;

    const nowIso = new Date().toISOString();
    const updated: Handoff = {
      ...existing,
      metadata: {
        ...currentMeta,
        managerNotificationStatus: 'PROCESSING',
        managerNotificationClaimedAt: nowIso,
      },
      updatedAt: new Date(),
    };
    this.db.set(id, updated);
    return true;
  }
}
