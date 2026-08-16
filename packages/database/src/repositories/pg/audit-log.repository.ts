import type pg from 'pg';
import type {
  AuditLog,
  CreateAuditLog,
  IAuditLogRepository,
  PaginatedResult,
} from '@limax/shared';

export class PgAuditLogRepository implements IAuditLogRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async create(data: CreateAuditLog): Promise<AuditLog> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO audit_logs (user_id, user_role, action, entity, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, user_role, action, entity, entity_id, details, created_at`,
      [
        data.userId,
        data.userRole,
        data.action,
        (data as unknown as { entityType?: string; entity?: string }).entityType || (data as unknown as { entityType?: string; entity?: string }).entity || 'products',
        data.entityId || null,
        data.details ? JSON.stringify(data.details) : null,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async findAll(params: { page?: number; limit?: number; entity?: string }): Promise<PaginatedResult<AuditLog>> {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const { entity } = params;
    const offset = (page - 1) * limit;
    const values: unknown[] = [];
    let where = '';

    if (entity) {
      where = 'WHERE entity = $1';
      values.push(entity);
    }

    const countRes = await this.pool.query<{ count: string }>(`SELECT COUNT(*) as count FROM audit_logs ${where}`, values);
    const total = parseInt(countRes.rows[0].count, 10);

    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    values.push(limit, offset);

    const dataRes = await this.pool.query<Record<string, unknown>>(
      `SELECT id, user_id, user_role, action, entity, entity_id, details, created_at FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values
    );

    return {
      data: dataRes.rows.map(this.mapRow),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private mapRow(row: Record<string, unknown>): AuditLog {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      userRole: row.user_role as AuditLog['userRole'],
      action: row.action as string,
      entity: row.entity as string,
      entityId: row.entity_id as string | undefined,
      details: row.details ? (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) : undefined,
      createdAt: new Date(row.created_at as string),
    };
  }
}
