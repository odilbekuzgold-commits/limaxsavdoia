import type pg from 'pg';
import type {
  TelegramUpdateReceipt,
  ITelegramUpdateReceiptRepository,
} from '@limax/shared';

export class PgTelegramUpdateReceiptRepository
  implements ITelegramUpdateReceiptRepository
{
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findByUpdateId(updateId: number): Promise<TelegramUpdateReceipt | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, update_id, update_type, status, error_code, received_at, processed_at FROM telegram_update_receipts WHERE update_id = $1`,
      [updateId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(
    data: Omit<TelegramUpdateReceipt, 'id' | 'receivedAt' | 'processedAt'>
  ): Promise<TelegramUpdateReceipt> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO telegram_update_receipts (update_id, update_type, status, error_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, update_id, update_type, status, error_code, received_at, processed_at`,
      [data.updateId, data.updateType, data.status, data.errorCode || null]
    );
    return this.mapRow(result.rows[0]);
  }

  async getLastUpdateAt(): Promise<Date | null> {
    const result = await this.pool.query<{ received_at: string }>(
      `SELECT received_at FROM telegram_update_receipts ORDER BY received_at DESC LIMIT 1`
    );
    return result.rows[0]?.received_at ? new Date(result.rows[0].received_at) : null;
  }

  async getLastErrorCode(): Promise<string | null> {
    const result = await this.pool.query<{ error_code: string }>(
      `SELECT error_code FROM telegram_update_receipts WHERE error_code IS NOT NULL ORDER BY received_at DESC LIMIT 1`
    );
    return result.rows[0]?.error_code || null;
  }

  private mapRow(row: Record<string, unknown>): TelegramUpdateReceipt {
    return {
      id: row.id as string,
      updateId: parseInt(row.update_id as string, 10),
      updateType: row.update_type as string,
      status: row.status as TelegramUpdateReceipt['status'],
      errorCode: row.error_code as string | undefined,
      receivedAt: new Date(row.received_at as string),
      processedAt: new Date(row.processed_at as string),
    };
  }
}
