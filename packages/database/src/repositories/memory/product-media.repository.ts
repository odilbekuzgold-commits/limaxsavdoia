import { randomUUID } from 'crypto';
import type {
  ProductMedia,
  CreateProductMedia,
  IProductMediaRepository,
} from '@limax/shared';

export class InMemoryProductMediaRepository implements IProductMediaRepository {
  private db: Map<string, ProductMedia> = new Map();

  async findByProductId(productId: string): Promise<ProductMedia[]> {
    return Array.from(this.db.values()).filter((m) => m.productId === productId);
  }

  async create(data: CreateProductMedia): Promise<ProductMedia> {
    const item: ProductMedia = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.db.set(item.id, item);
    return item;
  }

  seed(item: ProductMedia): void {
    this.db.set(item.id, item);
  }
}
