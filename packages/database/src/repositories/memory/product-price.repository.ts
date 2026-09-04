import { randomUUID } from 'crypto';
import type {
  ProductPrice,
  CreateProductPrice,
  IProductPriceRepository,
} from '@limax/shared';

export class InMemoryProductPriceRepository implements IProductPriceRepository {
  private db: Map<string, ProductPrice> = new Map();

  constructor(private productRepo?: { findById(id: string): Promise<{ id: string; price?: number; currency?: string; minimumOrder?: number; active?: boolean } | null> }) {}

  async findByProductId(productId: string): Promise<ProductPrice[]> {
    const list = Array.from(this.db.values())
      .filter((p) => p.productId === productId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (list.length === 0 && this.productRepo) {
      const prod = await this.productRepo.findById(productId);
      if (prod && typeof prod.price === 'number' && prod.price > 0 && prod.active !== false) {
        return [
          {
            id: `auto-price-${prod.id}`,
            productId: prod.id,
            price: prod.price ?? 0,
            currency: prod.currency ?? 'USD',
            paymentType: 'LEGACY',
            unit: 'kg',
            minimumQuantity: 1,
            active: true,
            validFrom: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
      }
    }
    return list;
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

  async getActivePrice(productId: string, paymentType?: string): Promise<ProductPrice | null> {
    const all = await this.findByProductId(productId);
    const now = new Date();
    for (const item of all) {
      if (!item.active) continue;
      if (item.validFrom && item.validFrom.getTime() > now.getTime()) continue;
      if (item.validUntil && item.validUntil.getTime() < now.getTime()) continue;
      if (paymentType && item.paymentType && item.paymentType !== paymentType) continue;
      return item;
    }
    return null;
  }

  async create(data: CreateProductPrice): Promise<ProductPrice> {
    const now = new Date();
    const item: ProductPrice = {
      ...data,
      paymentType: data.paymentType || 'LEGACY',
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
