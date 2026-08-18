import type pg from 'pg';
import type {
  GoogleSheetsSyncState,
  IGoogleSheetsSyncRepository,
} from '@limax/shared';

export class PgGoogleSheetsSyncRepository implements IGoogleSheetsSyncRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  private mapRow(row: Record<string, unknown>): GoogleSheetsSyncState {
    return {
      id: String(row.id),
      spreadsheetId: String(row.spreadsheet_id),
      status: row.status as GoogleSheetsSyncState['status'],
      lastAttemptAt: new Date(row.last_attempt_at as string),
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at as string) : null,
      checksum: row.checksum ? String(row.checksum) : null,
      productsCount: Number(row.products_count || 0),
      pricesCount: Number(row.prices_count || 0),
      inventoryCount: Number(row.inventory_count || 0),
      sanitizedError: row.sanitized_error ? String(row.sanitized_error) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  async create(data: Omit<GoogleSheetsSyncState, 'id' | 'createdAt' | 'updatedAt'>): Promise<GoogleSheetsSyncState> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO google_sheets_sync_state (
        spreadsheet_id, status, last_attempt_at, last_success_at, checksum,
        products_count, prices_count, inventory_count, sanitized_error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.spreadsheetId,
        data.status,
        data.lastAttemptAt ? new Date(data.lastAttemptAt) : new Date(),
        data.lastSuccessAt ? new Date(data.lastSuccessAt) : null,
        data.checksum || null,
        data.productsCount || 0,
        data.pricesCount || 0,
        data.inventoryCount || 0,
        data.sanitizedError || null,
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  async getLatest(spreadsheetId?: string): Promise<GoogleSheetsSyncState | null> {
    let query = `SELECT * FROM google_sheets_sync_state`;
    const params: unknown[] = [];
    if (spreadsheetId) {
      query += ` WHERE spreadsheet_id = $1`;
      params.push(spreadsheetId);
    }
    query += ` ORDER BY last_attempt_at DESC LIMIT 1`;

    const result = await this.pool.query<Record<string, unknown>>(query, params);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async getLatestSuccess(spreadsheetId?: string): Promise<GoogleSheetsSyncState | null> {
    let query = `SELECT * FROM google_sheets_sync_state WHERE status = 'SUCCESS'`;
    const params: unknown[] = [];
    if (spreadsheetId) {
      query += ` AND spreadsheet_id = $1`;
      params.push(spreadsheetId);
    }
    query += ` ORDER BY last_success_at DESC NULLS LAST LIMIT 1`;

    const result = await this.pool.query<Record<string, unknown>>(query, params);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }
}
