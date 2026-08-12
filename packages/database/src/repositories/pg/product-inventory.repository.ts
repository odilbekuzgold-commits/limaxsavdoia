import type pg from 'pg';
import type {
  ProductInventory,
  UpdateProductInventory,
  IProductInventoryRepository,
} from '@limax/shared';

export class PgProductInventoryRepository implements IProductInventoryRepository {
  constructor(private pool: pg.Pool) {}

  async findByProductId(productId: string): Promise<ProductInventory | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, updated_at FROM product_inventory WHERE product_id = $1',
      [productId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findAll(): Promise<ProductInventory[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, updated_at FROM product_inventory'
    );
    return result.rows.map(this.mapRow);
  }

  async upsert(productId: string, data: UpdateProductInventory): Promise<ProductInventory> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO product_inventory (product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (product_id) DO UPDATE SET
         status = COALESCE($2, product_inventory.status),
         available_quantity = COALESCE($3, product_inventory.available_quantity),
         reserved_quantity = COALESCE($4, product_inventory.reserved_quantity),
         unit = COALESCE($5, product_inventory.unit),
         warehouse = COALESCE($6, product_inventory.warehouse),
         updated_by = COALESCE($7, product_inventory.updated_by),
         updated_at = NOW()
       RETURNING id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, updated_at`,
      [
        productId,
        data.status || 'IN_STOCK',
        data.availableQuantity ?? 0,
        data.reservedQuantity ?? 0,
        data.unit || 'kg',
        data.warehouse || 'Main Warehouse',
        data.updatedBy || null,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): ProductInventory {
    return {
      id: row.id as string,
      productId: row.product_id as string,
      status: row.status as ProductInventory['status'],
      availableQuantity: parseFloat(row.available_quantity as string),
      reservedQuantity: parseFloat(row.reserved_quantity as string),
      unit: row.unit as string,
      warehouse: row.warehouse as string,
      updatedBy: row.updated_by as string | undefined,
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
