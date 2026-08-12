import type pg from 'pg';
import type {
  Product,
  CreateProduct,
  IProductRepository,
} from '@limax/shared';

export class PgProductRepository implements IProductRepository {
  constructor(private pool: pg.Pool) {}

  async findAll(params: { category?: string; activeOnly?: boolean }): Promise<Product[]> {
    const { category, activeOnly } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (category) {
      conditions.push(`category = $${paramIdx++}`);
      values.push(category);
    }
    if (activeOnly) {
      conditions.push(`active = $${paramIdx++}`);
      values.push(true);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataResult = await this.pool.query<Record<string, unknown>>(
      `SELECT id, name, category, description, price, currency, minimum_order, stock_status, media, active, created_at, updated_at FROM products ${where} ORDER BY created_at DESC`,
      values
    );

    return dataResult.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<Product | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, name, category, description, price, currency, minimum_order, stock_status, media, active, created_at, updated_at FROM products WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateProduct): Promise<Product> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO products (name, category, description, price, currency, minimum_order, stock_status, media, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, category, description, price, currency, minimum_order, stock_status, media, active, created_at, updated_at`,
      [data.name, data.category, data.description || null, data.price, data.currency || 'UZS', data.minimumOrder ?? 1, data.stockStatus || 'in_stock', data.media || [], data.active ?? true]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Product>): Promise<Product | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.category !== undefined) { sets.push(`category = $${idx++}`); values.push(data.category); }
    if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }
    if (data.price !== undefined) { sets.push(`price = $${idx++}`); values.push(data.price); }
    if (data.currency !== undefined) { sets.push(`currency = $${idx++}`); values.push(data.currency); }
    if (data.minimumOrder !== undefined) { sets.push(`minimum_order = $${idx++}`); values.push(data.minimumOrder); }
    if (data.stockStatus !== undefined) { sets.push(`stock_status = $${idx++}`); values.push(data.stockStatus); }
    if (data.media !== undefined) { sets.push(`media = $${idx++}`); values.push(data.media); }
    if (data.active !== undefined) { sets.push(`active = $${idx++}`); values.push(data.active); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, category, description, price, currency, minimum_order, stock_status, media, active, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Product {
    return {
      id: row.id as string,
      name: row.name as string,
      category: row.category as string,
      description: (row.description as string) || '',
      price: parseFloat(row.price as string),
      currency: row.currency as string,
      minimumOrder: row.minimum_order as number,
      stockStatus: row.stock_status as Product['stockStatus'],
      media: (row.media as string[]) || [],
      active: row.active as boolean,
      aiRecommendable: row.ai_recommendable !== undefined ? Boolean(row.ai_recommendable) : true,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
