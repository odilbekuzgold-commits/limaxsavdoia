import { randomUUID } from 'crypto';
import type {
  TelegramBusinessConnection,
  ITelegramBusinessConnectionRepository,
} from '@limax/shared';

export class InMemoryTelegramBusinessConnectionRepository
  implements ITelegramBusinessConnectionRepository
{
  private db: Map<string, TelegramBusinessConnection> = new Map();

  async findByConnectionId(
    connectionId: string
  ): Promise<TelegramBusinessConnection | null> {
    for (const conn of this.db.values()) {
      if (conn.connectionId === connectionId) return conn;
    }
    return null;
  }

  async findByBusinessUserId(
    businessUserId: string
  ): Promise<TelegramBusinessConnection | null> {
    for (const conn of this.db.values()) {
      if (conn.businessUserId === businessUserId) return conn;
    }
    return null;
  }

  async upsert(
    data: Omit<TelegramBusinessConnection, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<TelegramBusinessConnection> {
    const existing = await this.findByConnectionId(data.connectionId);
    const now = new Date();

    if (existing) {
      const updated: TelegramBusinessConnection = {
        ...existing,
        ...data,
        updatedAt: now,
      };
      this.db.set(existing.id, updated);
      return updated;
    }

    const created: TelegramBusinessConnection = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.db.set(created.id, created);
    return created;
  }

  async countActive(): Promise<number> {
    return Array.from(this.db.values()).filter((c) => c.isEnabled).length;
  }

  async countTotal(): Promise<number> {
    return this.db.size;
  }
}
