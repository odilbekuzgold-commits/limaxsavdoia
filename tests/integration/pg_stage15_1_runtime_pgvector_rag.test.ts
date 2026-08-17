import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import { runMigrations, createRepositories } from '../../packages/database/dist/index.js';
import {
  AIOrchestrator,
  MockEmbeddingProvider,
  chunkKnowledgeContent,
} from '../../packages/ai-engine/dist/index.js';
import { approveKnowledgeItem } from '../../apps/api/dist/modules/knowledge.js';
import type { Repositories } from '@limax/shared';

const { Pool } = pg;

function getTestDbUrl(): string {
  const dbUrl = process.env.LIMAX_TEST_DATABASE_URL;
  if (!dbUrl) {
    throw new Error('LIMAX_TEST_DATABASE_URL environment variable is required for PostgreSQL integration tests');
  }
  const parsed = new URL(dbUrl);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName.startsWith('limax_test') && !dbName.startsWith('limax_test_')) {
    throw new Error(`Safety check failed: Database name must start with 'limax_test', got '${dbName}'`);
  }
  return dbUrl;
}

describe('Stage 15.1: Real PostgreSQL pgvector Runtime RAG Integration Tests', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  const dbUrl = getTestDbUrl();

  before(async () => {
    pool = new Pool({ connectionString: dbUrl, max: 5 });
    await pool.query('SELECT 1');

    // Run all migrations including 013
    await runMigrations(pool);

    repos = createRepositories('postgres', pool);
  });

  after(async () => {
    if (pool) {
      // Clean up test knowledge data
      try {
        await pool.query("DELETE FROM knowledge_chunks WHERE content LIKE '%Stage 15.1%' OR content LIKE '%TEST_PGVECTOR%'");
        await pool.query("DELETE FROM knowledge_items WHERE title LIKE '%Stage 15.1%' OR title LIKE '%TEST_PGVECTOR%'");
      } catch {}
      await pool.end();
    }
  });

  it('1. Migration 013 applies cleanly and is idempotent', async () => {
    // Re-run migrations to ensure 013 is fully idempotent
    await runMigrations(pool);

    // Verify columns and constraints exist
    const colRes = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'knowledge_items' AND column_name IN ('valid_from', 'valid_until')
    `);
    assert.equal(colRes.rows.length, 2, 'valid_from and valid_until must exist on knowledge_items');

    const indexRes = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'knowledge_chunks' AND indexname = 'uq_knowledge_chunks_item_index'
    `);
    assert.equal(indexRes.rows.length, 1, 'uq_knowledge_chunks_item_index unique index must exist');
  });

  it('2. PgKnowledgeRepository.searchSimilar executes real pgvector cosine distance search', async () => {
    // Create 2 distinct knowledge items with orthogonal vector embeddings
    const item1 = await repos.knowledge.create({
      title: 'TEST_PGVECTOR: To‘lov shartlari',
      content: 'Barcha xalqaro buyurtmalar uchun 30% oldindan tolov talab qilinadi. Stage 15.1 test.',
      language: 'uz',
      status: 'APPROVED',
    });

    const item2 = await repos.knowledge.create({
      title: 'TEST_PGVECTOR: Yetkazib berish hududlari',
      content: 'MDH davlatlari va Turkiya hududiga yuklar 5 ish kunida yetkaziladi. Stage 15.1 test.',
      language: 'uz',
      status: 'APPROVED',
    });

    // Vector 1 has 1.0 at index 0, Vector 2 has 1.0 at index 1
    const vec1 = new Array(1536).fill(0);
    vec1[0] = 1.0;

    const vec2 = new Array(1536).fill(0);
    vec2[1] = 1.0;

    await repos.knowledge.replaceChunks(item1.id, [
      { chunkIndex: 0, content: item1.content, embedding: vec1 },
    ]);
    await repos.knowledge.replaceChunks(item2.id, [
      { chunkIndex: 0, content: item2.content, embedding: vec2 },
    ]);

    // Search with query vector pointing directly at vec1
    const queryVec1 = new Array(1536).fill(0);
    queryVec1[0] = 1.0;

    const results1 = await repos.knowledge.searchSimilar(queryVec1, {
      topK: 5,
      minScore: 0.5,
      now: new Date(),
    });

    assert.ok(results1.length >= 1);
    assert.equal(results1[0].knowledgeItemId, item1.id);
    assert.ok(results1[0].score > 0.99, `Score for identical vector should be ~1.0, got ${results1[0].score}`);

    // Search with query vector pointing at vec2
    const queryVec2 = new Array(1536).fill(0);
    queryVec2[1] = 1.0;

    const results2 = await repos.knowledge.searchSimilar(queryVec2, {
      topK: 5,
      minScore: 0.5,
      now: new Date(),
    });

    assert.ok(results2.length >= 1);
    assert.equal(results2[0].knowledgeItemId, item2.id);
    assert.ok(results2[0].score > 0.99);
  });

  it('3. Strict APPROVED & Unexpired Filter in PostgreSQL searchSimilar', async () => {
    // DRAFT item with matching vector
    const draftItem = await repos.knowledge.create({
      title: 'TEST_PGVECTOR: DRAFT Maxfiy',
      content: 'Maxfiy xomashyo formulasi Stage 15.1',
      language: 'uz',
      status: 'DRAFT',
    });
    const vec = new Array(1536).fill(0);
    vec[10] = 1.0;
    await repos.knowledge.replaceChunks(draftItem.id, [
      { chunkIndex: 0, content: draftItem.content, embedding: vec },
    ]);

    // Expired APPROVED item with matching vector
    const expiredItem = await repos.knowledge.create({
      title: 'TEST_PGVECTOR: Muddati otgan aksiya',
      content: '2019 yilgi aksiya Stage 15.1',
      language: 'uz',
      status: 'APPROVED',
    });
    await pool.query("UPDATE knowledge_items SET valid_until = NOW() - INTERVAL '1 day' WHERE id = $1", [expiredItem.id]);
    await repos.knowledge.replaceChunks(expiredItem.id, [
      { chunkIndex: 0, content: expiredItem.content, embedding: vec },
    ]);

    const queryVec = new Array(1536).fill(0);
    queryVec[10] = 1.0;

    const results = await repos.knowledge.searchSimilar(queryVec, {
      topK: 5,
      minScore: 0.5,
      now: new Date(),
    });

    assert.equal(
      results.some((r) => r.knowledgeItemId === draftItem.id),
      false,
      'DRAFT knowledge item must not be retrieved by pgvector search'
    );
    assert.equal(
      results.some((r) => r.knowledgeItemId === expiredItem.id),
      false,
      'Expired knowledge item must not be retrieved by pgvector search'
    );
  });

  it('4. Real AIOrchestrator pipeline retrieves knowledge via PostgreSQL pgvector in runtime', async () => {
    const kb = await repos.knowledge.create({
      title: 'TEST_PGVECTOR: Kompaniya Kafolat Siyosati',
      content: 'LImax barcha kalava ip mahsulotlariga xalqaro ISO 9001 sertifikati kafolatini taqdim etadi. Stage 15.1 test.',
      language: 'uz',
      status: 'APPROVED',
    });

    const mockEmb = new MockEmbeddingProvider();
    const [chunkEmb] = await mockEmb.embed([kb.content]);

    await repos.knowledge.replaceChunks(kb.id, [
      { chunkIndex: 0, content: kb.content, embedding: chunkEmb },
    ]);

    const orchestrator = new AIOrchestrator({
      repos,
      aiMode: 'mock',
      embeddingProvider: mockEmb,
    });

    const result = await orchestrator.processQuery('LImax ISO sertifikati va sifat kafolati qanday?');
    assert.ok(result.usedKnowledgeIds.includes(kb.id), 'AI Orchestrator should include pgvector matched knowledge ID');
    assert.equal(result.needsHandoff, false);
  });

  it('5. replaceChunks maintains transactional atomicity and unique chunk indexing in PostgreSQL', async () => {
    const item = await repos.knowledge.create({
      title: 'TEST_PGVECTOR: Atomicity Test',
      content: 'Birinchi bo‘lim matni. Ikkinchi bo‘lim matni.',
      language: 'uz',
      status: 'APPROVED',
    });

    const vec = new Array(1536).fill(0.005);

    // Initial 2 chunks
    await repos.knowledge.replaceChunks(item.id, [
      { chunkIndex: 0, content: 'Birinchi bo‘lim matni.', embedding: vec },
      { chunkIndex: 1, content: 'Ikkinchi bo‘lim matni.', embedding: vec },
    ]);

    let chunkRows = await pool.query('SELECT chunk_index FROM knowledge_chunks WHERE knowledge_item_id = $1 ORDER BY chunk_index', [item.id]);
    assert.equal(chunkRows.rows.length, 2);

    // Replace with 1 chunk
    await repos.knowledge.replaceChunks(item.id, [
      { chunkIndex: 0, content: 'Yangi yagona bo‘lim matni.', embedding: vec },
    ]);

    chunkRows = await pool.query('SELECT chunk_index FROM knowledge_chunks WHERE knowledge_item_id = $1', [item.id]);
    assert.equal(chunkRows.rows.length, 1);
  });
});
