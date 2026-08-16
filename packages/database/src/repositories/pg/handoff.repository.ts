import type pg from 'pg';
import type {
  Handoff,
  IHandoffRepository,
} from '@limax/shared';

export class PgHandoffRepository implements IHandoffRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  private selectCols =
    'id, conversation_id, customer_id, reason, priority, status, notes, metadata, assigned_manager_id, assigned_at, accepted_at, resolved_at, created_at, updated_at';

  async findByConversationId(conversationId: string): Promise<Handoff[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${this.selectCols} FROM handoffs WHERE conversation_id = $1 ORDER BY created_at DESC`,
      [conversationId]
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async findById(id: string): Promise<Handoff | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT ${this.selectCols} FROM handoffs WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: Omit<Handoff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Handoff> {
    const metaJson = JSON.stringify(data.metadata || {});
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO handoffs (conversation_id, customer_id, reason, priority, status, notes, metadata, assigned_manager_id, assigned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING ${this.selectCols}`,
      [
        data.conversationId,
        data.customerId,
        data.reason,
        data.priority || 'medium',
        data.status || 'PENDING',
        data.notes || null,
        metaJson,
        data.assignedManagerId || null,
        data.assignedManagerId ? new Date() : null,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Handoff>): Promise<Handoff | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.assignedManagerId !== undefined) {
      sets.push(`assigned_manager_id = $${idx++}`);
      values.push(data.assignedManagerId);
      sets.push(`assigned_at = $${idx++}`);
      values.push(data.assignedManagerId ? new Date() : null);
    }
    if (data.acceptedAt !== undefined) {
      sets.push(`accepted_at = $${idx++}`);
      values.push(data.acceptedAt ? new Date(data.acceptedAt) : null);
    }
    if (data.resolvedAt !== undefined) {
      sets.push(`resolved_at = $${idx++}`);
      values.push(data.resolvedAt ? new Date(data.resolvedAt) : null);
    }
    if (data.priority !== undefined) {
      sets.push(`priority = $${idx++}`);
      values.push(data.priority);
    }
    if (data.status !== undefined) {
      sets.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.notes !== undefined) {
      sets.push(`notes = $${idx++}`);
      values.push(data.notes);
    }
    if (data.metadata !== undefined) {
      sets.push(`metadata = $${idx++}::jsonb`);
      values.push(JSON.stringify(data.metadata || {}));
    }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE handoffs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${this.selectCols}`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async claimManagerNotificationDelivery(id: string, timeoutMs = 30000): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const cutoffDate = new Date(Date.now() - timeoutMs).toISOString();

    const result = await this.pool.query(
      `UPDATE handoffs
       SET metadata = jsonb_set(
             jsonb_set(COALESCE(metadata, '{}'::jsonb), '{managerNotificationStatus}', '"PROCESSING"'::jsonb),
             '{managerNotificationClaimedAt}', to_jsonb($2::text)
           ),
           updated_at = NOW()
       WHERE id = $1
         AND (
           (metadata->>'managerNotificationStatus') IS NULL
           OR (metadata->>'managerNotificationStatus') IN ('PENDING', 'FAILED', 'NOT_SENT')
           OR (
             (metadata->>'managerNotificationStatus') = 'PROCESSING'
             AND (metadata->>'managerNotificationClaimedAt') IS NOT NULL
             AND (metadata->>'managerNotificationClaimedAt')::timestamptz < $3::timestamptz
           )
         )
       RETURNING id`,
      [id, nowIso, cutoffDate]
    );

    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: Record<string, unknown>): Handoff {
    let metadata: Record<string, unknown> = {};
    if (typeof row.metadata === 'object' && row.metadata !== null) {
      metadata = row.metadata as Record<string, unknown>;
    } else if (typeof row.metadata === 'string') {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = {};
      }
    }

    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      customerId: row.customer_id as string,
      reason: row.reason as string,
      priority: row.priority as Handoff['priority'],
      status: (row.status as Handoff['status']) || 'PENDING',
      notes: row.notes as string | undefined,
      metadata,
      assignedManagerId: row.assigned_manager_id as string | undefined,
      assignedAt: row.assigned_at ? new Date(row.assigned_at as string) : undefined,
      acceptedAt: row.accepted_at ? new Date(row.accepted_at as string) : undefined,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
