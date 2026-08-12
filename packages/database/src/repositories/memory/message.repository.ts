import { randomUUID } from 'crypto';
import type { Message, IMessageRepository } from '@limax/shared';

export class InMemoryMessageRepository implements IMessageRepository {
  private db: Message[] = [];

  async findByConversationId(conversationId: string): Promise<Message[]> {
    return this.db.filter((m) => m.conversationId === conversationId);
  }

  async create(data: Omit<Message, 'id' | 'createdAt' | 'updatedAt'>): Promise<Message> {
    const now = new Date();
    const message: Message = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.push(message);
    return message;
  }
}
