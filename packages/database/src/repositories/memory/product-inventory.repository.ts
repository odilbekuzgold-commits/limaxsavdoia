import { randomUUID } from 'crypto';
import type {
  ProductInventory,
  UpdateProductInventory,
  IProductInventoryRepository,
} from '@limax/shared';

export class InMemoryProductInventoryRepository implements IProductInventoryRepository {
  private db: Map<string, ProductInventory> = new Map(); // key = productId

  constructor(private productRepo?: { findById(id: string): Promise<{ id: string; stockStatus?: string } | null> }) {}

  async findByProductId(productId: string): Promise<ProductInventory | null> {
    const existing = this.db.get(productId);
    if (existing) return existing;
    if (this.productRepo) {
      const prod = await this.productRepo.findById(productId);
      if (prod && prod.stockStatus) {
        const isOut = prod.stockStatus === 'out_of_stock';
        return {
          id: `auto-inv-${prod.id}`,
          productId: prod.id,
          availableQuantity: isOut ? 0 : 1000,
          reservedQuantity: 0,
          unit: 'kg',
          version: 1,
          status: isOut ? 'OUT_OF_STOCK' : 'IN_STOCK',
          updatedAt: new Date(),
        };
      }
    }
    return null;
  }

  async findAll(): Promise<ProductInventory[]> {
    return Array.from(this.db.values());
  }

  async upsert(productId: string, data: UpdateProductInventory): Promise<ProductInventory> {
    const existing = this.db.get(productId);
    const now = new Date();

    if (existing && data.expectedVersion !== undefined && existing.version !== data.expectedVersion) {
      const err = new Error(`Inventory version conflict: expected version ${data.expectedVersion}, but found ${existing.version}`);
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { statusCode: number; code: string }).code = 'INVENTORY_VERSION_CONFLICT';
      throw err;
    }

    const avail = data.availableQuantity !== undefined ? data.availableQuantity : existing?.availableQuantity ?? 0;
    const res = data.reservedQuantity !== undefined ? data.reservedQuantity : existing?.reservedQuantity ?? 0;
    const netAvailable = avail - res;

    if (avail < 0) {
      throw new Error('availableQuantity must be >= 0');
    }
    if (res < 0) {
      throw new Error('reservedQuantity must be >= 0');
    }
    if (res > avail) {
      throw new Error('reservedQuantity cannot exceed availableQuantity');
    }

    const derivedStatus = data.status === 'UNKNOWN'
      ? 'UNKNOWN'
      : (avail <= 0 || netAvailable <= 0 ? 'OUT_OF_STOCK' : (data.status || existing?.status || 'IN_STOCK'));
    const newVersion = existing ? (existing.version || 1) + 1 : 1;

    const item: ProductInventory = {
      id: existing?.id || randomUUID(),
      productId,
      status: derivedStatus,
      availableQuantity: avail,
      reservedQuantity: res,
      unit: data.unit || existing?.unit || 'kg',
      warehouse: data.warehouse !== undefined ? data.warehouse : existing?.warehouse,
      updatedBy: data.updatedBy || existing?.updatedBy,
      version: newVersion,
      updatedAt: now,
    };

    this.db.set(productId, item);
    return item;
  }

  seed(item: ProductInventory): void {
    this.db.set(item.productId, item);
  }
}
