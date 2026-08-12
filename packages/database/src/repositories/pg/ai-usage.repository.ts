import type pg from 'pg';
import type { AIUsageLog, IAIUsageRepository } from '@limax/shared';

export class PgAIUsageRepository implements IAIUsageRepository {
  constructor(private pool: pg.Pool) {}

  async create(data: Omit<AIUsageLog, 'id' | 'createdAt'>): Promise<AIUsageLog> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO ai_usage_logs (
        provider, model, input_tokens, output_tokens, estimated_cost, latency_ms, status, fallback_used, conversation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, provider, model, input_tokens, output_tokens, estimated_cost, latency_ms, status, fallback_used, conversation_id, created_at`,
      [
        data.provider,
        data.model,
        data.inputTokens,
        data.outputTokens,
        data.estimatedCost,
        data.latencyMs,
        data.status,
        data.fallbackUsed,
        data.conversationId || null,
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  async findByConversationId(conversationId: string): Promise<AIUsageLog[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, provider, model, input_tokens, output_tokens, estimated_cost, latency_ms, status, fallback_used, conversation_id, created_at
       FROM ai_usage_logs
       WHERE conversation_id = $1
       ORDER BY created_at DESC`,
      [conversationId]
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Record<string, unknown>): AIUsageLog {
    return {
      id: row.id as string,
      provider: row.provider as string,
      model: row.model as string,
      inputTokens: parseInt(String(row.input_tokens || 0), 10),
      outputTokens: parseInt(String(row.output_tokens || 0), 10),
      estimatedCost: parseFloat(String(row.estimated_cost || 0)),
      latencyMs: parseInt(String(row.latency_ms || 0), 10),
      status: row.status as AIUsageLog['status'],
      fallbackUsed: Boolean(row.fallback_used),
      conversationId: (row.conversation_id as string) || undefined,
      createdAt: new Date(row.created_at as string),
    };
  }
}
