import type pg from 'pg';
import type {
  KnowledgeItem,
  CreateKnowledgeItem,
  IKnowledgeRepository,
  SupportedLanguage,
  KnowledgeStatus,
  KnowledgeSearchResult,
} from '@limax/shared';

export class PgKnowledgeRepository implements IKnowledgeRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

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
      `SELECT id, title, content, language, status, source, approved_by, approved_at, valid_from, valid_until, created_at, updated_at FROM knowledge_items ${where} ORDER BY created_at DESC`,
      values
    );

    return dataResult.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<KnowledgeItem | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, title, content, language, status, source, approved_by, approved_at, valid_from, valid_until, created_at, updated_at FROM knowledge_items WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<KnowledgeItem | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, title, content, language, status, source, approved_by, approved_at, valid_from, valid_until, created_at, updated_at FROM knowledge_items WHERE id = $1 FOR UPDATE',
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateKnowledgeItem): Promise<KnowledgeItem> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO knowledge_items (title, content, language, status, source, valid_from, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, content, language, status, source, approved_by, approved_at, valid_from, valid_until, created_at, updated_at`,
      [
        data.title,
        data.content,
        data.language || 'uz',
        data.status || 'DRAFT',
        data.source || null,
        data.validFrom || null,
        data.validUntil || null,
      ]
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
      let approvedByVal: string | null = null;
      if (data.approvedBy) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.approvedBy);
        approvedByVal = isUuid ? data.approvedBy : '00000000-0000-0000-0000-000000000001';
      }
      sets.push(`approved_by = $${idx++}`); values.push(approvedByVal);
      sets.push(`approved_at = $${idx++}`); values.push(data.approvedAt !== undefined ? data.approvedAt : (data.approvedBy ? new Date() : null));
    }
    if (data.validFrom !== undefined) { sets.push(`valid_from = $${idx++}`); values.push(data.validFrom); }
    if (data.validUntil !== undefined) { sets.push(`valid_until = $${idx++}`); values.push(data.validUntil); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE knowledge_items SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, title, content, language, status, source, approved_by, approved_at, valid_from, valid_until, created_at, updated_at`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async searchSimilar(
    embedding: number[],
    options: {
      language?: SupportedLanguage;
      topK: number;
      minScore: number;
      now: Date;
    }
  ): Promise<KnowledgeSearchResult[]> {
    // 1. Fail-fast embedding validation (exactly 1536 finite numbers)
    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      throw new Error(`Invalid embedding dimension: expected exactly 1536 floats, got ${embedding?.length ?? 0}`);
    }

    for (let i = 0; i < embedding.length; i++) {
      if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
        throw new Error(`Invalid embedding vector element at index ${i}: must be a finite number`);
      }
    }

    const topK = Math.max(1, Math.min(10, options.topK || 5));
    const minScore = typeof options.minScore === 'number' ? options.minScore : 0.6;
    const now = options.now instanceof Date ? options.now : new Date();
    const vectorStr = `[${embedding.join(',')}]`;

    // 2. Query knowledge_chunks joined with knowledge_items
    // Cosine similarity: 1 - (kc.embedding <=> $1::vector)
    const query = `
      SELECT
        kc.id AS chunk_id,
        ki.id AS knowledge_item_id,
        ki.title,
        kc.content,
        ki.language,
        ki.source,
        (1 - (kc.embedding <=> $1::vector)) AS score,
        kc.metadata
      FROM knowledge_chunks kc
      JOIN knowledge_items ki ON ki.id = kc.knowledge_item_id
      WHERE ki.status = 'APPROVED'
        AND (ki.valid_from IS NULL OR ki.valid_from <= $2)
        AND (ki.valid_until IS NULL OR ki.valid_until > $2)
        AND ($3::text IS NULL OR ki.language = $3)
        AND kc.embedding IS NOT NULL
        AND (1 - (kc.embedding <=> $1::vector)) >= $4
      ORDER BY score DESC
      LIMIT $5
    `;

    const result = await this.pool.query<Record<string, unknown>>(query, [
      vectorStr,
      now,
      options.language || null,
      minScore,
      topK,
    ]);

    return result.rows.map((row) => ({
      chunkId: row.chunk_id as string,
      knowledgeItemId: row.knowledge_item_id as string,
      title: row.title as string,
      content: row.content as string,
      language: row.language as SupportedLanguage,
      source: (row.source as string) || undefined,
      score: parseFloat(String(row.score)),
      metadata: (row.metadata as Record<string, unknown>) || undefined,
    }));
  }

  async replaceChunks(
    knowledgeItemId: string,
    chunks: Array<{
      chunkIndex: number;
      content: string;
      language?: SupportedLanguage;
      embedding?: number[];
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    // Delete existing chunks for this knowledge item
    await this.pool.query('DELETE FROM knowledge_chunks WHERE knowledge_item_id = $1', [knowledgeItemId]);

    // Insert new chunks
    for (const chunk of chunks) {
      let vectorStr: string | null = null;
      if (chunk.embedding && Array.isArray(chunk.embedding)) {
        if (chunk.embedding.length !== 1536) {
          throw new Error(`Chunk embedding must be exactly 1536 dimensions, got ${chunk.embedding.length}`);
        }
        for (let i = 0; i < chunk.embedding.length; i++) {
          if (typeof chunk.embedding[i] !== 'number' || !Number.isFinite(chunk.embedding[i])) {
            throw new Error(`Invalid chunk embedding value at index ${i}`);
          }
        }
        vectorStr = `[${chunk.embedding.join(',')}]`;
      }

      await this.pool.query(
        `INSERT INTO knowledge_chunks (knowledge_item_id, chunk_index, content, language, embedding, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6, NOW(), NOW())`,
        [
          knowledgeItemId,
          chunk.chunkIndex,
          chunk.content,
          chunk.language || 'uz',
          vectorStr,
          JSON.stringify(chunk.metadata || {}),
        ]
      );
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM knowledge_items WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
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
      validFrom: row.valid_from ? new Date(row.valid_from as string) : undefined,
      validUntil: row.valid_until ? new Date(row.valid_until as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
