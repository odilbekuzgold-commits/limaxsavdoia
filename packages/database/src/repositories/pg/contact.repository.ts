import type pg from 'pg';
import type {
  Contact,
  IContactRepository,
} from '@limax/shared';

export class PgContactRepository implements IContactRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findByCustomerId(customerId: string): Promise<Contact[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, customer_id, channel, external_id, username, phone, is_primary, created_at, updated_at FROM contacts WHERE customer_id = $1 ORDER BY created_at DESC',
      [customerId]
    );
    return result.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<Contact | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, customer_id, channel, external_id, username, phone, is_primary, created_at, updated_at FROM contacts WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findByChannelAndExternalId(channel: string, externalId: string): Promise<Contact | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, customer_id, channel, external_id, username, phone, is_primary, created_at, updated_at FROM contacts WHERE channel = $1 AND external_id = $2',
      [channel, externalId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO contacts (customer_id, channel, external_id, username, phone, is_primary) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, customer_id, channel, external_id, username, phone, is_primary, created_at, updated_at`,
      [data.customerId, data.channel, data.externalId, data.username || null, data.phone || null, data.isPrimary ?? false]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Contact>): Promise<Contact | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.username !== undefined) { sets.push(`username = $${idx++}`); values.push(data.username); }
    if (data.phone !== undefined) { sets.push(`phone = $${idx++}`); values.push(data.phone); }
    if (data.isPrimary !== undefined) { sets.push(`is_primary = $${idx++}`); values.push(data.isPrimary); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE contacts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, customer_id, channel, external_id, username, phone, is_primary, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Contact {
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      channel: row.channel as Contact['channel'],
      externalId: row.external_id as string,
      username: row.username as string | undefined,
      phone: row.phone as string | undefined,
      isPrimary: row.is_primary as boolean,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
