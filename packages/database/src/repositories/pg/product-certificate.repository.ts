import type pg from 'pg';
import type {
  ProductCertificate,
  CreateProductCertificate,
  IProductCertificateRepository,
} from '@limax/shared';

export class PgProductCertificateRepository implements IProductCertificateRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findByProductId(productId: string): Promise<ProductCertificate[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, name, certificate_number, issuer, valid_from, valid_until, file_url, active, created_at, updated_at FROM product_certificates WHERE product_id = $1',
      [productId]
    );
    return result.rows.map(this.mapRow);
  }

  async findActiveByProductId(productId: string, date: Date = new Date()): Promise<ProductCertificate[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, product_id, name, certificate_number, issuer, valid_from, valid_until, file_url, active, created_at, updated_at FROM product_certificates WHERE product_id = $1 AND active = true AND (valid_from IS NULL OR valid_from <= $2) AND (valid_until IS NULL OR valid_until >= $2)',
      [productId, date]
    );
    return result.rows.map(this.mapRow);
  }

  async create(data: CreateProductCertificate): Promise<ProductCertificate> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO product_certificates (product_id, name, certificate_number, issuer, valid_from, valid_until, file_url, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, product_id, name, certificate_number, issuer, valid_from, valid_until, file_url, active, created_at, updated_at`,
      [
        data.productId,
        data.name,
        data.certificateNumber,
        data.issuer,
        data.validFrom || new Date(),
        data.validUntil || null,
        data.fileUrl || null,
        data.active !== undefined ? data.active : true,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): ProductCertificate {
    return {
      id: row.id as string,
      productId: row.product_id as string,
      name: row.name as string,
      certificateNumber: row.certificate_number as string,
      issuer: row.issuer as string,
      validFrom: new Date(row.valid_from as string),
      validUntil: row.valid_until ? new Date(row.valid_until as string) : undefined,
      fileUrl: row.file_url as string | undefined,
      active: row.active as boolean,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
