import type pg from 'pg';
import type {
  ProductMedia,
  CreateProductMedia,
  IProductMediaRepository,
} from '@limax/shared';

export class PgProductMediaRepository implements IProductMediaRepository {
  constructor(private pool: pg.Pool) {}

  async findByProductId(productId: string): Promise<ProductMedia[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, type, title, storage_key, mime_type, active, created_at FROM product_media WHERE product_id = $1',
      [productId]
    );
    return result.rows.map(this.mapRow);
  }

  async create(data: CreateProductMedia): Promise<ProductMedia> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO product_media (product_id, type, title, storage_key, mime_type, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, product_id, type, title, storage_key, mime_type, active, created_at`,
      [
        data.productId,
        data.type,
        data.title,
        data.storageKey,
        data.mimeType || 'application/octet-stream',
        data.active !== undefined ? data.active : true,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): ProductMedia {
    return {
      id: row.id as string,
      productId: row.product_id as string,
      type: row.type as ProductMedia['type'],
      title: row.title as string,
      storageKey: row.storage_key as string,
      mimeType: row.mime_type as string,
      active: row.active as boolean,
      createdAt: new Date(row.created_at as string),
    };
  }
}
