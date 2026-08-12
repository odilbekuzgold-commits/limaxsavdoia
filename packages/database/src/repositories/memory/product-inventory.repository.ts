import { randomUUID } from 'crypto';
import type {
  ProductInventory,
  UpdateProductInventory,
  IProductInventoryRepository,
} from '@limax/shared';

export class InMemoryProductInventoryRepository implements IProductInventoryRepository {
  private db: Map<string, ProductInventory> = new Map(); // key = productId

  async findByProductId(productId: string): Promise<ProductInventory | null> {
    return this.db.get(productId) ?? null;
  }

  async findAll(): Promise<ProductInventory[]> {
    return Array.from(this.db.values());
  }

  async upsert(productId: string, data: UpdateProductInventory): Promise<ProductInventory> {
    const existing = this.db.get(productId);
    const now = new Date();

    const avail = data.availableQuantity !== undefined ? data.availableQuantity : existing?.availableQuantity ?? 0;
    const res = data.reservedQuantity !== undefined ? data.reservedQuantity : existing?.reservedQuantity ?? 0;

    if (avail < 0) {
      throw new Error('availableQuantity must be >= 0');
    }
    if (res < 0) {
      throw new Error('reservedQuantity must be >= 0');
    }
    if (res > avail) {
      throw new Error('reservedQuantity cannot exceed availableQuantity');
    }

    const item: ProductInventory = {
      id: existing?.id || randomUUID(),
      productId,
      status: data.status || existing?.status || 'IN_STOCK',
      availableQuantity: avail,
      reservedQuantity: res,
      unit: data.unit || existing?.unit || 'kg',
      warehouse: data.warehouse || existing?.warehouse || 'Main Warehouse',
      updatedBy: data.updatedBy || existing?.updatedBy,
      updatedAt: now,
    };

    this.db.set(productId, item);
    return item;
  }

  seed(item: ProductInventory): void {
    this.db.set(item.productId, item);
  }
}
