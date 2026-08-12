import type pg from 'pg';
import type {
  Conversation,
  IConversationRepository,
} from '@limax/shared';

export class PgConversationRepository implements IConversationRepository {
  constructor(private pool: pg.Pool) {}

  async findAll(params: { status?: string }): Promise<Conversation[]> {
    const { status } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataResult = await this.pool.query<Record<string, unknown>>(
      `SELECT id, customer_id, contact_id, status, channel, last_message_at, created_at, updated_at FROM conversations ${where} ORDER BY last_message_at DESC NULLS LAST`,
      values
    );

    return dataResult.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<Conversation | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, customer_id, contact_id, status, channel, last_message_at, created_at, updated_at FROM conversations WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO conversations (customer_id, contact_id, status, channel, last_message_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, customer_id, contact_id, status, channel, last_message_at, created_at, updated_at`,
      [data.customerId, data.contactId, data.status || 'active', data.channel, data.lastMessageAt ? new Date(data.lastMessageAt) : null]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Conversation>): Promise<Conversation | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.lastMessageAt !== undefined) { sets.push(`last_message_at = $${idx++}`); values.push(data.lastMessageAt ? new Date(data.lastMessageAt) : null); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, customer_id, contact_id, status, channel, last_message_at, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      contactId: row.contact_id as string,
      status: row.status as Conversation['status'],
      channel: row.channel as Conversation['channel'],
      lastMessageAt: new Date(row.last_message_at as string),
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
