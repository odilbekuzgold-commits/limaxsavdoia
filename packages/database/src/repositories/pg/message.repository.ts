import type pg from 'pg';
import type {
  Message,
  IMessageRepository,
} from '@limax/shared';

export class PgMessageRepository implements IMessageRepository {
  constructor(private pool: pg.Pool) {}

  async findByConversationId(conversationId: string): Promise<Message[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, conversation_id, sender_type, sender_id, content, content_type, status, metadata, created_at, updated_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );
    return result.rows.map(this.mapRow);
  }

  async create(data: Omit<Message, 'id' | 'createdAt' | 'updatedAt'>): Promise<Message> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, content, content_type, status, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, conversation_id, sender_type, sender_id, content, content_type, status, metadata, created_at, updated_at`,
      [data.conversationId, data.senderType, data.senderId || null, data.content, data.contentType || 'text', data.status || 'sent', data.metadata ? JSON.stringify(data.metadata) : null]
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      senderType: row.sender_type as Message['senderType'],
      senderId: row.sender_id as string | undefined,
      content: row.content as string,
      contentType: row.content_type as Message['contentType'],
      status: row.status as Message['status'],
      metadata: row.metadata as Record<string, unknown> | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
