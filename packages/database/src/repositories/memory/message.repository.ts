import { randomUUID } from 'crypto';
import type { Message, IMessageRepository } from '@limax/shared';

export class InMemoryMessageRepository implements IMessageRepository {
  private db: Message[] = [];

  async findByConversationId(conversationId: string): Promise<Message[]> {
    return this.db.filter((m) => m.conversationId === conversationId);
  }

  async create(data: Omit<Message, 'id' | 'createdAt' | 'updatedAt'>): Promise<Message> {
    const now = new Date();
    const createdAt = (data as any).createdAt ? new Date((data as any).createdAt) : now;
    const message: Message = { ...data, id: randomUUID(), createdAt, updatedAt: now };
    this.db.push(message);
    return message;
  }
}
