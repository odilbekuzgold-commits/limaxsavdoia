import type pg from 'pg';
import type {
  ProductPrice,
  CreateProductPrice,
  IProductPriceRepository,
  PaymentType,
} from '@limax/shared';

export class PgProductPriceRepository implements IProductPriceRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  private selectCols = `
    id, product_id, price, currency, payment_type, unit, minimum_quantity,
    valid_from, valid_until, active, notes, source_system, external_row_id,
    source_updated_at, synced_at, updated_by, created_at, updated_at
  `;

  async findByProductId(productId: string): Promise<ProductPrice[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${this.selectCols} FROM product_prices WHERE product_id = $1 ORDER BY created_at DESC`,
      [productId]
    );
    return result.rows.map(this.mapRow);
  }

  async findActiveByProductId(productId: string, date: Date = new Date()): Promise<ProductPrice | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${this.selectCols} 
       FROM product_prices 
       WHERE product_id = $1 AND active = true AND (valid_from IS NULL OR valid_from <= $2) AND (valid_until IS NULL OR valid_until >= $2) 
       ORDER BY created_at DESC LIMIT 1`,
      [productId, date]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async getActivePrice(productId: string, paymentType?: string): Promise<ProductPrice | null> {
    const conditions = ['product_id = $1', 'active = true', '(valid_from IS NULL OR valid_from <= NOW())', '(valid_until IS NULL OR valid_until >= NOW())'];
    const values: unknown[] = [productId];

    if (paymentType) {
      conditions.push(`payment_type = $2`);
      values.push(paymentType);
    }

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${this.selectCols} 
       FROM product_prices 
       WHERE ${conditions.join(' AND ')} 
       ORDER BY created_at DESC LIMIT 1`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateProductPrice): Promise<ProductPrice> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO product_prices (
        product_id, price, currency, payment_type, unit, minimum_quantity,
        valid_from, valid_until, active, notes, source_system, external_row_id,
        source_updated_at, synced_at, updated_by
      ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
       RETURNING ${this.selectCols}`,
      [
        data.productId,
        data.price,
        data.currency || 'USD',
        data.paymentType || 'LEGACY',
        data.unit || 'kg',
        data.minimumQuantity || 1,
        data.validFrom || new Date(),
        data.validUntil || null,
        data.active !== undefined ? data.active : true,
        data.notes || null,
        data.sourceSystem || 'GOOGLE_SHEETS',
        data.externalRowId || null,
        data.sourceUpdatedAt || null,
        data.syncedAt || null,
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
    if (data.paymentType !== undefined) { sets.push(`payment_type = $${idx++}`); values.push(data.paymentType); }
    if (data.active !== undefined) { sets.push(`active = $${idx++}`); values.push(data.active); }
    if (data.validUntil !== undefined) { sets.push(`valid_until = $${idx++}`); values.push(data.validUntil); }
    if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(data.notes); }
    if (data.sourceSystem !== undefined) { sets.push(`source_system = $${idx++}`); values.push(data.sourceSystem); }
    if (data.externalRowId !== undefined) { sets.push(`external_row_id = $${idx++}`); values.push(data.externalRowId); }
    if (data.sourceUpdatedAt !== undefined) { sets.push(`source_updated_at = $${idx++}`); values.push(data.sourceUpdatedAt); }
    if (data.syncedAt !== undefined) { sets.push(`synced_at = $${idx++}`); values.push(data.syncedAt); }

    if (sets.length === 0) return null;

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE product_prices SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${this.selectCols}`,
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
      paymentType: (row.payment_type as PaymentType) || 'LEGACY',
      unit: row.unit as string,
      minimumQuantity: parseFloat(row.minimum_quantity as string),
      validFrom: new Date(row.valid_from as string),
      validUntil: row.valid_until ? new Date(row.valid_until as string) : undefined,
      active: row.active as boolean,
      notes: row.notes as string | undefined,
      sourceSystem: row.source_system as string | undefined,
      externalRowId: row.external_row_id as string | undefined,
      sourceUpdatedAt: row.source_updated_at ? new Date(row.source_updated_at as string) : undefined,
      syncedAt: row.synced_at ? new Date(row.synced_at as string) : undefined,
      updatedBy: row.updated_by as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
