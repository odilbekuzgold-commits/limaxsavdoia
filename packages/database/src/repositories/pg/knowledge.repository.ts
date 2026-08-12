import type pg from 'pg';
import type {
  KnowledgeItem,
  CreateKnowledgeItem,
  IKnowledgeRepository,
  SupportedLanguage,
  KnowledgeStatus,
} from '@limax/shared';

export class PgKnowledgeRepository implements IKnowledgeRepository {
  constructor(private pool: pg.Pool) {}

  async findAll(params: { language?: SupportedLanguage; status?: KnowledgeStatus }): Promise<KnowledgeItem[]> {
    const { language, status } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (language) {
      conditions.push(`language = $${paramIdx++}`);
      values.push(language);
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataResult = await this.pool.query<Record<string, unknown>>(
      `SELECT id, title, content, language, status, source, approved_by, approved_at, created_at, updated_at FROM knowledge_items ${where} ORDER BY created_at DESC`,
      values
    );

    return dataResult.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<KnowledgeItem | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, title, content, language, status, source, approved_by, approved_at, created_at, updated_at FROM knowledge_items WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateKnowledgeItem): Promise<KnowledgeItem> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO knowledge_items (title, content, language, status, source) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, content, language, status, source, approved_by, approved_at, created_at, updated_at`,
      [data.title, data.content, data.language || 'uz', data.status || 'draft', data.source || null]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: Partial<KnowledgeItem>): Promise<KnowledgeItem | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.title !== undefined) { sets.push(`title = $${idx++}`); values.push(data.title); }
    if (data.content !== undefined) { sets.push(`content = $${idx++}`); values.push(data.content); }
    if (data.language !== undefined) { sets.push(`language = $${idx++}`); values.push(data.language); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.source !== undefined) { sets.push(`source = $${idx++}`); values.push(data.source); }
    if (data.approvedBy !== undefined) {
      sets.push(`approved_by = $${idx++}`); values.push(data.approvedBy);
      sets.push(`approved_at = $${idx++}`); values.push(data.approvedBy ? new Date() : null);
    }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE knowledge_items SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, title, content, language, status, source, approved_by, approved_at, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): KnowledgeItem {
    return {
      id: row.id as string,
      title: row.title as string,
      content: row.content as string,
      language: row.language as KnowledgeItem['language'],
      status: row.status as KnowledgeItem['status'],
      source: row.source as string | undefined,
      approvedBy: row.approved_by as string | undefined,
      approvedAt: row.approved_at ? new Date(row.approved_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
