import type pg from 'pg';
import type {
  TelegramBusinessConnection,
  ITelegramBusinessConnectionRepository,
} from '@limax/shared';

export class PgTelegramBusinessConnectionRepository
  implements ITelegramBusinessConnectionRepository
{
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findByConnectionId(
    connectionId: string
  ): Promise<TelegramBusinessConnection | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, connection_id, business_user_id, user_chat_id, is_enabled, rights, connected_at, created_at, updated_at FROM telegram_business_connections WHERE connection_id = $1`,
      [connectionId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findByBusinessUserId(
    businessUserId: string
  ): Promise<TelegramBusinessConnection | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, connection_id, business_user_id, user_chat_id, is_enabled, rights, connected_at, created_at, updated_at FROM telegram_business_connections WHERE business_user_id = $1`,
      [businessUserId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async upsert(
    data: Omit<TelegramBusinessConnection, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<TelegramBusinessConnection> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO telegram_business_connections (connection_id, business_user_id, user_chat_id, is_enabled, rights, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (connection_id) DO UPDATE SET
         business_user_id = EXCLUDED.business_user_id,
         user_chat_id = EXCLUDED.user_chat_id,
         is_enabled = EXCLUDED.is_enabled,
         rights = EXCLUDED.rights,
         connected_at = EXCLUDED.connected_at,
         updated_at = NOW()
       RETURNING id, connection_id, business_user_id, user_chat_id, is_enabled, rights, connected_at, created_at, updated_at`,
      [
        data.connectionId,
        data.businessUserId,
        data.userChatId,
        data.isEnabled,
        data.rights ? JSON.stringify(data.rights) : '{}',
        data.connectedAt,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async countActive(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM telegram_business_connections WHERE is_enabled = TRUE`
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  async countTotal(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM telegram_business_connections`
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  private mapRow(row: Record<string, unknown>): TelegramBusinessConnection {
    return {
      id: row.id as string,
      connectionId: row.connection_id as string,
      businessUserId: row.business_user_id as string,
      userChatId: row.user_chat_id as string,
      isEnabled: Boolean(row.is_enabled),
      rights: row.rights as Record<string, unknown> | undefined,
      connectedAt: new Date(row.connected_at as string),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
