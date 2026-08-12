import { randomUUID } from 'crypto';
import type {
  ProductCertificate,
  CreateProductCertificate,
  IProductCertificateRepository,
} from '@limax/shared';

export class InMemoryProductCertificateRepository implements IProductCertificateRepository {
  private db: Map<string, ProductCertificate> = new Map();

  async findByProductId(productId: string): Promise<ProductCertificate[]> {
    return Array.from(this.db.values()).filter((c) => c.productId === productId);
  }

  async findActiveByProductId(productId: string, date: Date = new Date()): Promise<ProductCertificate[]> {
    return Array.from(this.db.values()).filter((c) => {
      if (c.productId !== productId || !c.active) return false;
      if (c.validFrom && c.validFrom.getTime() > date.getTime()) return false;
      if (c.validUntil && c.validUntil.getTime() < date.getTime()) return false;
      return true;
    });
  }

  async create(data: CreateProductCertificate): Promise<ProductCertificate> {
    const now = new Date();
    const item: ProductCertificate = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.db.set(item.id, item);
    return item;
  }

  seed(item: ProductCertificate): void {
    this.db.set(item.id, item);
  }
}
