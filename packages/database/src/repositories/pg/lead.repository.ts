import type pg from 'pg';
import type {
  Lead,
  ILeadRepository,
  LeadTemperature,
} from '@limax/shared';

export class PgLeadRepository implements ILeadRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findAll(params: { temperature?: LeadTemperature; stage?: string }): Promise<Lead[]> {
    const { temperature, stage } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (temperature) {
      conditions.push(`temperature = $${paramIdx++}`);
      values.push(temperature);
    }
    if (stage) {
      conditions.push(`stage = $${paramIdx++}`);
      values.push(stage);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataResult = await this.pool.query<Record<string, unknown>>(
      `SELECT id, customer_id, conversation_id, score, temperature, stage, product_interest, estimated_value, next_action, assigned_manager_id, created_at, updated_at FROM leads ${where} ORDER BY created_at DESC`,
      values
    );

    return dataResult.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<Lead | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, customer_id, conversation_id, score, temperature, stage, product_interest, estimated_value, next_action, assigned_manager_id, created_at, updated_at FROM leads WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO leads (customer_id, conversation_id, score, temperature, stage, product_interest, estimated_value, next_action, assigned_manager_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, customer_id, conversation_id, score, temperature, stage, product_interest, estimated_value, next_action, assigned_manager_id, created_at, updated_at`,
      [data.customerId, data.conversationId, data.score ?? 0, data.temperature || 'cold', data.stage || 'new', data.productInterest || null, data.estimatedValue || null, data.nextAction || null, data.assignedManagerId || null]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<Lead>): Promise<Lead | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.score !== undefined) { sets.push(`score = $${idx++}`); values.push(data.score); }
    if (data.temperature !== undefined) { sets.push(`temperature = $${idx++}`); values.push(data.temperature); }
    if (data.stage !== undefined) { sets.push(`stage = $${idx++}`); values.push(data.stage); }
    if (data.productInterest !== undefined) { sets.push(`product_interest = $${idx++}`); values.push(data.productInterest); }
    if (data.estimatedValue !== undefined) { sets.push(`estimated_value = $${idx++}`); values.push(data.estimatedValue); }
    if (data.nextAction !== undefined) { sets.push(`next_action = $${idx++}`); values.push(data.nextAction); }
    if (data.assignedManagerId !== undefined) { sets.push(`assigned_manager_id = $${idx++}`); values.push(data.assignedManagerId); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, customer_id, conversation_id, score, temperature, stage, product_interest, estimated_value, next_action, assigned_manager_id, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Lead {
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      conversationId: row.conversation_id as string,
      score: row.score as number,
      temperature: row.temperature as Lead['temperature'],
      stage: row.stage as Lead['stage'],
      productInterest: row.product_interest as string | undefined,
      estimatedValue: row.estimated_value ? parseFloat(row.estimated_value as string) : undefined,
      nextAction: row.next_action as string | undefined,
      assignedManagerId: row.assigned_manager_id as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
