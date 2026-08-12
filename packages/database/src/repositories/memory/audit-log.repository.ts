import { randomUUID } from 'crypto';
import type {
  AuditLog,
  CreateAuditLog,
  IAuditLogRepository,
  PaginatedResult,
} from '@limax/shared';

export class InMemoryAuditLogRepository implements IAuditLogRepository {
  private db: AuditLog[] = [];

  async create(data: CreateAuditLog): Promise<AuditLog> {
    const item: AuditLog = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.db.unshift(item); // Newest first
    return item;
  }

  async findAll(params: { page: number; limit: number; entity?: string }): Promise<PaginatedResult<AuditLog>> {
    const { page, limit, entity } = params;
    const filtered = this.db.filter((item) => (entity ? item.entity === entity : true));
    const total = filtered.length;
    const data = filtered.slice((page - 1) * limit, page * limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
