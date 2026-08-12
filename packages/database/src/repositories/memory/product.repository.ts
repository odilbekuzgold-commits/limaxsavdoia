import { randomUUID } from 'crypto';
import type { Product, CreateProduct, IProductRepository } from '@limax/shared';

export class InMemoryProductRepository implements IProductRepository {
  private db: Map<string, Product> = new Map();

  async findAll(params: { category?: string; activeOnly?: boolean }): Promise<Product[]> {
    return Array.from(this.db.values()).filter((p) => {
      const catMatch = params.category ? p.category.toLowerCase().includes(params.category.toLowerCase()) : true;
      const actMatch = params.activeOnly ? p.active === true : true;
      return catMatch && actMatch;
    });
  }

  async findById(id: string): Promise<Product | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: CreateProduct): Promise<Product> {
    const now = new Date();
    const product: Product = { ...data, aiRecommendable: data.aiRecommendable !== undefined ? data.aiRecommendable : true, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.set(product.id, product);
    return product;
  }

  async update(id: string, data: Partial<Product>): Promise<Product | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Product = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  seed(product: Product): void {
    this.db.set(product.id, product);
  }
}
