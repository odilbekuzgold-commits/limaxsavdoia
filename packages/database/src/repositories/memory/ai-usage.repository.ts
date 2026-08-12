import { randomUUID } from 'crypto';
import type { AIUsageLog, IAIUsageRepository } from '@limax/shared';

export class InMemoryAIUsageRepository implements IAIUsageRepository {
  private db: AIUsageLog[] = [];

  async create(data: Omit<AIUsageLog, 'id' | 'createdAt'>): Promise<AIUsageLog> {
    const log: AIUsageLog = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.db.push(log);
    return log;
  }

  async findByConversationId(conversationId: string): Promise<AIUsageLog[]> {
    return this.db.filter((log) => log.conversationId === conversationId);
  }
}
