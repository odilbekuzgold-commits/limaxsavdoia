import type pg from 'pg';
import type {
  ProductPrice,
  CreateProductPrice,
  IProductPriceRepository,
} from '@limax/shared';

export class PgProductPriceRepository implements IProductPriceRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findByProductId(productId: string): Promise<ProductPrice[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, price, currency, unit, minimum_quantity, valid_from, valid_until, active, notes, updated_by, created_at, updated_at FROM product_prices WHERE product_id = $1 ORDER BY created_at DESC',
      [productId]
    );
    return result.rows.map(this.mapRow);
  }

  async findActiveByProductId(productId: string, date: Date = new Date()): Promise<ProductPrice | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, product_id, price, currency, unit, minimum_quantity, valid_from, valid_until, active, notes, updated_by, created_at, updated_at 
       FROM product_prices 
       WHERE product_id = $1 AND active = true AND (valid_from IS NULL OR valid_from <= $2) AND (valid_until IS NULL OR valid_until >= $2) 
       ORDER BY created_at DESC LIMIT 1`,
      [productId, date]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateProductPrice): Promise<ProductPrice> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO product_prices (product_id, price, currency, unit, minimum_quantity, valid_from, valid_until, active, notes, updated_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id, product_id, price, currency, unit, minimum_quantity, valid_from, valid_until, active, notes, updated_by, created_at, updated_at`,
      [
        data.productId,
        data.price,
        data.currency || 'USD',
        data.unit || 'kg',
        data.minimumQuantity || 1,
        data.validFrom || new Date(),
        data.validUntil || null,
        data.active !== undefined ? data.active : true,
        data.notes || null,
        data.updatedBy || null,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<ProductPrice>): Promise<ProductPrice | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.price !== undefined) { sets.push(`price = $${idx++}`); values.push(data.price); }
    if (data.active !== undefined) { sets.push(`active = $${idx++}`); values.push(data.active); }
    if (data.validUntil !== undefined) { sets.push(`valid_until = $${idx++}`); values.push(data.validUntil); }
    if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(data.notes); }

    if (sets.length === 0) return null;

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE product_prices SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, product_id, price, currency, unit, minimum_quantity, valid_from, valid_until, active, notes, updated_by, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): ProductPrice {
    return {
      id: row.id as string,
      productId: row.product_id as string,
      price: parseFloat(row.price as string),
      currency: row.currency as string,
      unit: row.unit as string,
      minimumQuantity: parseFloat(row.minimum_quantity as string),
      validFrom: new Date(row.valid_from as string),
      validUntil: row.valid_until ? new Date(row.valid_until as string) : undefined,
      active: row.active as boolean,
      notes: row.notes as string | undefined,
      updatedBy: row.updated_by as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
