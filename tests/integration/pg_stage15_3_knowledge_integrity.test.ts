import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import express, { type Express } from '../../apps/api/node_modules/express/index.js';
import { createRepositories, runMigrations, type Repositories } from '../../packages/database/dist/index.js';
import { createKnowledgeRouter, approveKnowledgeItem } from '../../apps/api/dist/modules/knowledge.js';
import { requireInternalApiToken } from '../../apps/api/dist/common/middleware/auth.js';
import type { EmbeddingProvider } from '../../packages/ai-engine/dist/index.js';

const TEST_INTERNAL_TOKEN = 'stage15_3_secret_token_abcdef';

class PgStage15_3_MockEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'mock';
  readonly modelName = 'text-embedding-3-small';
  public callCount = 0;

  async embed(texts: string[]): Promise<number[][]> {
    this.callCount++;
    return texts.map(() => new Array(1536).fill(0.015));
  }
}

function getTestDbUrl(): string {
  const dbUrl = process.env.LIMAX_TEST_DATABASE_URL;
  if (!dbUrl) {
    throw new Error('LIMAX_TEST_DATABASE_URL environment variable is required for PostgreSQL integration tests');
  }
  return dbUrl;
}

describe('Stage 15.3: Real PostgreSQL Knowledge Index Integrity & Atomic Deletion Integration Tests', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  let app: Express;
  let server: http.Server;
  let baseUrl: string;
  let mockProvider: PgStage15_3_MockEmbeddingProvider;

  before(async () => {
    const testDbUrl = getTestDbUrl();
    const dbName = new URL(testDbUrl).pathname.replace(/^\//, '');
    if (!dbName.includes('test')) {
      throw new Error(`Refusing to run tests on non-test DB: ${dbName}`);
    }

    pool = new pg.Pool({ connectionString: testDbUrl });
    await pool.query('SELECT 1');

    // Run migrations up to 013
    await runMigrations(pool, { driver: 'postgres' });

    repos = createRepositories('postgres', pool);
    mockProvider = new PgStage15_3_MockEmbeddingProvider();

    app = express();
    app.use(express.json());

    // Internal API Token Authentication
    app.use(
      '/api/v1/knowledge',
      requireInternalApiToken(TEST_INTERNAL_TOKEN),
      createKnowledgeRouter({
        repos,
        driver: 'postgres',
        pool,
        embeddingProvider: mockProvider,
      })
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool) {
      await pool.end();
    }
  });

  it('1. APPROVED item with zero chunks triggers re-indexing and audit log in PostgreSQL', async () => {
    // Manually create an APPROVED item with 0 chunks (simulating legacy data)
    const itemRes = await pool.query(
      `INSERT INTO knowledge_items (title, content, language, status, created_at, updated_at)
       VALUES ('Legacy Unindexed Item', 'Ushbu mahsulot haqidagi ma’lumotlar.', 'uz', 'APPROVED', NOW(), NOW())
       RETURNING id, status`
    );
    const legacyItem = itemRes.rows[0];

    const stateBefore = await repos.knowledge.getIndexState(legacyItem.id);
    assert.equal(stateBefore.chunkCount, 0, 'Initially must have 0 chunks');

    // Call approve via HTTP
    const res = await fetch(`${baseUrl}/api/v1/knowledge/${legacyItem.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });

    assert.equal(res.status, 200);

    const stateAfter = await repos.knowledge.getIndexState(legacyItem.id);
    assert.ok(stateAfter.chunkCount >= 1, 'Re-indexing must generate chunks in knowledge_chunks table');
    assert.equal(stateAfter.dimensions[0], 1536);
    assert.equal(stateAfter.models[0], 'text-embedding-3-small');

    // Verify audit log recorded REINDEX_KNOWLEDGE_ITEM
    const auditRes = await pool.query(
      "SELECT action FROM audit_logs WHERE entity = 'knowledge_items' AND entity_id = $1 AND action = 'REINDEX_KNOWLEDGE_ITEM'",
      [legacyItem.id]
    );
    assert.ok(auditRes.rows.length >= 1, 'Must record REINDEX_KNOWLEDGE_ITEM in audit_logs');
  });

  it('2. APPROVED item with stale contentHash triggers re-indexing', async () => {
    const item = await repos.knowledge.create({
      title: 'Stale Hash DB Item',
      content: 'Yangi haqiqiy matn.',
      language: 'uz',
      status: 'APPROVED',
    });

    // Seed stale chunk
    await pool.query(
      `INSERT INTO knowledge_chunks (knowledge_item_id, chunk_index, content, language, embedding, metadata, created_at, updated_at)
       VALUES ($1, 0, 'Eski matn', 'uz', $2::vector, $3, NOW(), NOW())`,
      [item.id, `[${new Array(1536).fill(0.01).join(',')}]`, JSON.stringify({ contentHash: 'stale_hash_xyz', dimensions: 1536, model: 'text-embedding-3-small' })]
    );

    const stateBefore = await repos.knowledge.getIndexState(item.id);
    assert.equal(stateBefore.contentHashes[0], 'stale_hash_xyz');

    const res = await fetch(`${baseUrl}/api/v1/knowledge/${item.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });
    assert.equal(res.status, 200);

    const stateAfter = await repos.knowledge.getIndexState(item.id);
    assert.notEqual(stateAfter.contentHashes[0], 'stale_hash_xyz', 'Must replace stale hash with current contentHash');
  });

  it('3. Healthy index is idempotent across HTTP calls without redundant re-indexing', async () => {
    const draft = await repos.knowledge.create({
      title: 'Healthy DB Item',
      content: 'Toza va sog‘lom matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    const callsBefore = mockProvider.callCount;

    // First approval
    const res1 = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}` },
    });
    assert.equal(res1.status, 200);
    const callsAfter1 = mockProvider.callCount;
    assert.equal(callsAfter1, callsBefore + 1);

    // Second approval
    const res2 = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}` },
    });
    assert.equal(res2.status, 200);
    const callsAfter2 = mockProvider.callCount;
    assert.equal(callsAfter2, callsAfter1, 'Healthy item approval must be idempotent and make 0 extra embedding calls');
  });

  it('4. Atomic DELETE + Audit: Deleting item removes item and cascade chunks, and writes audit', async () => {
    const draft = await repos.knowledge.create({
      title: 'Delete Target Item',
      content: 'O‘chirilishi kerak bo‘lgan kontent.',
      language: 'uz',
      status: 'DRAFT',
    });

    // Approve first
    await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}` },
    });

    // Delete via HTTP
    const delRes = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}` },
    });
    assert.equal(delRes.status, 200);

    const itemCheck = (await pool.query('SELECT count(*) FROM knowledge_items WHERE id = $1', [draft.id])).rows[0].count;
    assert.equal(itemCheck, '0');

    const chunkCheck = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;
    assert.equal(chunkCheck, '0');

    const auditCheck = (await pool.query("SELECT count(*) FROM audit_logs WHERE entity = 'knowledge_items' AND entity_id = $1 AND action = 'DELETE_KNOWLEDGE_ITEM'", [draft.id])).rows[0].count;
    assert.ok(parseInt(auditCheck, 10) >= 1);
  });

  it('5. Atomic PATCH on APPROVED item resets to DRAFT and invalidates chunks', async () => {
    const draft = await repos.knowledge.create({
      title: 'Patch Target Item',
      content: 'Asl matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    // Approve
    await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}` },
    });

    // Verify chunks exist
    const chunksBefore = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;
    assert.ok(parseInt(chunksBefore, 10) >= 1);

    // Patch content
    const patchRes = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({ content: 'O‘zgartirilgan yangi matn.' }),
    });

    assert.equal(patchRes.status, 200);
    const patchedBody = await patchRes.json() as any;
    assert.equal(patchedBody.data.status, 'DRAFT');

    // Chunks must be invalidated (0 chunks)
    const chunksAfter = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;
    assert.equal(chunksAfter, '0', 'Old chunks must be invalidated on content update of APPROVED item');
  });

  it('6. PostgreSQL Fail-Fast: missing pool fails fast with 503 and does not fallback to memory', async () => {
    const appWithoutPool = express();
    appWithoutPool.use(express.json());
    appWithoutPool.use(
      '/api/v1/knowledge',
      requireInternalApiToken(TEST_INTERNAL_TOKEN),
      createKnowledgeRouter({
        repos,
        driver: 'postgres',
        pool: undefined, // Missing pool
        embeddingProvider: mockProvider,
      })
    );

    let tempServer: http.Server;
    let tempBaseUrl: string;

    await new Promise<void>((resolve) => {
      tempServer = appWithoutPool.listen(0, '127.0.0.1', () => {
        const tempAddr = tempServer.address() as { port: number };
        tempBaseUrl = `http://127.0.0.1:${tempAddr.port}`;
        resolve();
      });
    });

    try {
      const res = await fetch(`${tempBaseUrl!}/api/v1/knowledge/some-id/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}` },
      });

      assert.equal(res.status, 503);
      const body = await res.json() as any;
      assert.equal(body.error.code, 'CONFIGURATION_ERROR');
      assert.match(body.error.message, /requires a PostgreSQL pool/i);
    } finally {
      await new Promise<void>((resolve) => tempServer.close(() => resolve()));
    }
  });
});
