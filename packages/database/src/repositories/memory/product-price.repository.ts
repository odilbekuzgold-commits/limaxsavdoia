import { randomUUID } from 'crypto';
import type {
  ProductPrice,
  CreateProductPrice,
  IProductPriceRepository,
} from '@limax/shared';

export class InMemoryProductPriceRepository implements IProductPriceRepository {
  private db: Map<string, ProductPrice> = new Map();

  async findByProductId(productId: string): Promise<ProductPrice[]> {
    return Array.from(this.db.values())
      .filter((p) => p.productId === productId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findActiveByProductId(productId: string, date: Date = new Date()): Promise<ProductPrice | null> {
    const all = await this.findByProductId(productId);
    for (const item of all) {
      if (!item.active) continue;
      if (item.validFrom && item.validFrom.getTime() > date.getTime()) continue;
      if (item.validUntil && item.validUntil.getTime() < date.getTime()) continue;
      return item;
    }
    return null;
  }

  async create(data: CreateProductPrice): Promise<ProductPrice> {
    const now = new Date();
    // Validate overlapping active prices for same product, currency and unit
    if (data.active !== false) {
      const activePrices = (await this.findByProductId(data.productId)).filter((p) => p.active);
      const isOverlap = activePrices.some(
        (p) => p.currency === data.currency && p.unit === data.unit && (!p.validUntil || p.validUntil.getTime() > now.getTime())
      );
      if (isOverlap) {
        throw new Error(`Overlapping active price already exists for currency '${data.currency}' and unit '${data.unit}'`);
      }
    }

    const item: ProductPrice = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.db.set(item.id, item);
    return item;
  }

  async update(id: string, data: Partial<ProductPrice>): Promise<ProductPrice | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: ProductPrice = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  seed(item: ProductPrice): void {
    this.db.set(item.id, item);
  }
}
