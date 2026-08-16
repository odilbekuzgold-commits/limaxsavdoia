import type pg from 'pg';
import type {
  ProductInventory,
  UpdateProductInventory,
  IProductInventoryRepository,
} from '@limax/shared';

export class PgProductInventoryRepository implements IProductInventoryRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findByProductId(productId: string): Promise<ProductInventory | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, version, updated_at FROM product_inventory WHERE product_id = $1',
      [productId]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findAll(): Promise<ProductInventory[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, version, updated_at FROM product_inventory'
    );
    return result.rows.map(this.mapRow);
  }

  async upsert(productId: string, data: UpdateProductInventory): Promise<ProductInventory> {
    const existing = await this.findByProductId(productId);

    if (existing && data.expectedVersion !== undefined && existing.version !== data.expectedVersion) {
      const err = new Error(`Inventory version conflict: expected version ${data.expectedVersion}, but found ${existing.version}`);
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { statusCode: number; code: string }).code = 'INVENTORY_VERSION_CONFLICT';
      throw err;
    }

    if (existing) {
      const expectedVer = data.expectedVersion ?? existing.version;
      const result = await this.pool.query<Record<string, unknown>>(
        `UPDATE product_inventory SET
           status = COALESCE($2, product_inventory.status),
           available_quantity = COALESCE($3, product_inventory.available_quantity),
           reserved_quantity = COALESCE($4, product_inventory.reserved_quantity),
           unit = COALESCE($5, product_inventory.unit),
           warehouse = COALESCE($6, product_inventory.warehouse),
           updated_by = COALESCE($7, product_inventory.updated_by),
           version = product_inventory.version + 1,
           updated_at = NOW()
         WHERE product_id = $1 AND version = $8
         RETURNING id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, version, updated_at`,
        [
          productId,
          data.status || null,
          data.availableQuantity ?? null,
          data.reservedQuantity ?? null,
          data.unit || null,
          data.warehouse || null,
          data.updatedBy || null,
          expectedVer,
        ]
      );

      if (!result.rows[0]) {
        const err = new Error(`Inventory version conflict or concurrent modification for product ${productId}`);
        (err as unknown as { statusCode: number; code: string }).statusCode = 409;
        (err as unknown as { statusCode: number; code: string }).code = 'INVENTORY_VERSION_CONFLICT';
        throw err;
      }

      return this.mapRow(result.rows[0]);
    } else {
      const result = await this.pool.query<Record<string, unknown>>(
        `INSERT INTO product_inventory (product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
         RETURNING id, product_id, status, available_quantity, reserved_quantity, unit, warehouse, updated_by, version, updated_at`,
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
      version: typeof row.version === 'number' ? row.version : parseInt(String(row.version || 1), 10),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
