import type pg from 'pg';
import type {
  Customer,
  CreateCustomer,
  ICustomerRepository,
  PaginatedResult,
} from '@limax/shared';

export class PgCustomerRepository implements ICustomerRepository {
  constructor(private pool: pg.Pool) {}

  async findAll(params: { page: number; limit: number; search?: string }): Promise<PaginatedResult<Customer>> {
    const { page, limit, search } = params;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(LOWER(name) LIKE $${paramIdx} OR $${paramIdx + 1} = ANY(tags))`);
      values.push(`%${search.toLowerCase()}%`, search.toLowerCase());
      paramIdx += 2;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM customers ${where}`, values
    );
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(limit, offset);
    const dataResult = await this.pool.query<Record<string, unknown>>(
      `SELECT id, name, preferred_language, status, tags, notes, created_at, updated_at FROM customers ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      values
    );

    return {
      data: dataResult.rows.map(this.mapRow),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findById(id: string): Promise<Customer | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, name, preferred_language, status, tags, notes, created_at, updated_at FROM customers WHERE id = $1', [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateCustomer): Promise<Customer> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO customers (name, preferred_language, status, tags, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, preferred_language, status, tags, notes, created_at, updated_at`,
      [data.name, data.preferredLanguage || 'uz', data.status || 'active', data.tags || [], data.notes || null]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Customer>): Promise<Customer | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.preferredLanguage !== undefined) { sets.push(`preferred_language = $${idx++}`); values.push(data.preferredLanguage); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.tags !== undefined) { sets.push(`tags = $${idx++}`); values.push(data.tags); }
    if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(data.notes); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, preferred_language, status, tags, notes, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Customer {
    return {
      id: row.id as string,
      name: row.name as string,
      preferredLanguage: row.preferred_language as Customer['preferredLanguage'],
      status: row.status as Customer['status'],
      tags: (row.tags as string[]) || [],
      notes: row.notes as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
