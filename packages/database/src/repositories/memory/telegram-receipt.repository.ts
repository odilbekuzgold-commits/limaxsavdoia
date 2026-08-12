import { randomUUID } from 'crypto';
import type {
  TelegramUpdateReceipt,
  ITelegramUpdateReceiptRepository,
} from '@limax/shared';

export class InMemoryTelegramUpdateReceiptRepository
  implements ITelegramUpdateReceiptRepository
{
  private db: Map<number, TelegramUpdateReceipt> = new Map();
  private lastUpdateAt: Date | null = null;
  private lastErrorCode: string | null = null;

  async findByUpdateId(updateId: number): Promise<TelegramUpdateReceipt | null> {
    return this.db.get(updateId) ?? null;
  }

  async create(
    data: Omit<TelegramUpdateReceipt, 'id' | 'receivedAt' | 'processedAt'>
  ): Promise<TelegramUpdateReceipt> {
    const now = new Date();
    const receipt: TelegramUpdateReceipt = {
      ...data,
      id: randomUUID(),
      receivedAt: now,
      processedAt: now,
    };
    this.db.set(data.updateId, receipt);
    this.lastUpdateAt = now;
    if (data.errorCode) {
      this.lastErrorCode = data.errorCode;
    }
    return receipt;
  }

  async getLastUpdateAt(): Promise<Date | null> {
    return this.lastUpdateAt;
  }

  async getLastErrorCode(): Promise<string | null> {
    return this.lastErrorCode;
  }
}
