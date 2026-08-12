import type pg from 'pg';
import type {
  Handoff,
  IHandoffRepository,
} from '@limax/shared';

export class PgHandoffRepository implements IHandoffRepository {
  constructor(private pool: pg.Pool) {}

  async findByConversationId(conversationId: string): Promise<Handoff[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, conversation_id, customer_id, reason, priority, assigned_manager_id, assigned_at, accepted_at, resolved_at, created_at, updated_at FROM handoffs WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId]
    );
    return result.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<Handoff | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, conversation_id, customer_id, reason, priority, assigned_manager_id, assigned_at, accepted_at, resolved_at, created_at, updated_at FROM handoffs WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: Omit<Handoff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Handoff> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO handoffs (conversation_id, customer_id, reason, priority, assigned_manager_id, assigned_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, conversation_id, customer_id, reason, priority, assigned_manager_id, assigned_at, accepted_at, resolved_at, created_at, updated_at`,
      [data.conversationId, data.customerId, data.reason, data.priority || 'medium', data.assignedManagerId || null, data.assignedManagerId ? new Date() : null]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Handoff>): Promise<Handoff | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.assignedManagerId !== undefined) {
      sets.push(`assigned_manager_id = $${idx++}`); values.push(data.assignedManagerId);
      sets.push(`assigned_at = $${idx++}`); values.push(data.assignedManagerId ? new Date() : null);
    }
    if (data.acceptedAt !== undefined) { sets.push(`accepted_at = $${idx++}`); values.push(data.acceptedAt ? new Date(data.acceptedAt) : null); }
    if (data.resolvedAt !== undefined) { sets.push(`resolved_at = $${idx++}`); values.push(data.resolvedAt ? new Date(data.resolvedAt) : null); }
    if (data.priority !== undefined) { sets.push(`priority = $${idx++}`); values.push(data.priority); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE handoffs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, conversation_id, customer_id, reason, priority, assigned_manager_id, assigned_at, accepted_at, resolved_at, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Handoff {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      customerId: row.customer_id as string,
      reason: row.reason as string,
      priority: row.priority as Handoff['priority'],
      status: (row.status as Handoff['status']) || 'PENDING',
      notes: row.notes as string | undefined,
      assignedManagerId: row.assigned_manager_id as string | undefined,
      assignedAt: row.assigned_at ? new Date(row.assigned_at as string) : undefined,
      acceptedAt: row.accepted_at ? new Date(row.accepted_at as string) : undefined,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
