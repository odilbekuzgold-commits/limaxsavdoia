import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express } from '../../apps/api/node_modules/express/index.js';
import type { Server } from 'node:http';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import { runMigrations, createRepositories, withTransaction } from '../../packages/database/dist/index.js';
import {
  AIOrchestrator,
  MockEmbeddingProvider,
} from '../../packages/ai-engine/dist/index.js';
import {
  createKnowledgeRouter,
  approveKnowledgeItem,
} from '../../apps/api/dist/modules/knowledge.js';
import { requireInternalApiToken } from '../../apps/api/dist/common/middleware/auth.js';
import type { Repositories } from '@limax/shared';

const { Pool } = pg;

const TEST_INTERNAL_TOKEN = 'stage15-2-test-token-xyz';

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

describe('Stage 15.2: Real HTTP Atomic Knowledge Approval & pgvector Lifecycle Tests', () => {
  let pool: pg.Pool;
  let repos: Repositories;
  let server: Server;
  let baseUrl: string;
  const dbUrl = getTestDbUrl();

  before(async () => {
    pool = new Pool({ connectionString: dbUrl, max: 10 });
    await pool.query('SELECT 1');

    await runMigrations(pool);
    repos = createRepositories('postgres', pool);

    // Setup Express App
    const app: Express = express();
    app.use(express.json());

    const embeddingProvider = new MockEmbeddingProvider();

    app.use(
      '/api/v1/knowledge',
      requireInternalApiToken(TEST_INTERNAL_TOKEN),
      createKnowledgeRouter({
        repos,
        driver: 'postgres',
        pool,
        embeddingProvider,
        actorResolver: (req) => {
          const reqWithUser = req as unknown as { user?: { id?: string; role?: any } };
          return {
            id: reqWithUser.user?.id || 'dashboard-admin',
            role: reqWithUser.user?.role || 'ADMIN',
          };
        },
      })
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool) {
      try {
        await pool.query("DELETE FROM knowledge_chunks WHERE content LIKE '%STAGE15_2%'");
        await pool.query("DELETE FROM knowledge_items WHERE title LIKE '%STAGE15_2%'");
      } catch {}
      await pool.end();
    }
  });

  it('1. POST /api/v1/knowledge with status=APPROVED is strictly rejected with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        title: 'STAGE15_2 Rejected Item',
        content: 'Matn',
        status: 'APPROVED',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'INVALID_STATUS');
  });

  it('2. POST /api/v1/knowledge creates a DRAFT knowledge item', async () => {
    const res = await fetch(`${baseUrl}/api/v1/knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        title: 'STAGE15_2 Yangi Qoidalar',
        content: 'LImax barcha mahsulotlariga xalqaro standartlar asosida sifat kafolati beradi. STAGE15_2 test matni.',
        language: 'uz',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json() as any;
    assert.ok(body.data?.id);
    assert.equal(body.data.status, 'DRAFT');
  });

  it('3. PATCH /api/v1/knowledge/:id with status=APPROVED is strictly rejected with 400', async () => {
    const draft = await repos.knowledge.create({
      title: 'STAGE15_2 Draft Item',
      content: 'Test content',
      language: 'uz',
      status: 'DRAFT',
    });

    const res = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        status: 'APPROVED',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'INVALID_STATUS_UPDATE');
  });

  it('4. POST /api/v1/knowledge/:id/approve requires authentication and ignores spoofed managerId', async () => {
    const draft = await repos.knowledge.create({
      title: 'STAGE15_2 Shartnoma Nizomi',
      content: 'Barcha xalqaro shartnomalar 30 foiz oldindan tolov asosida tuziladi. STAGE15_2 test.',
      language: 'uz',
      status: 'DRAFT',
    });

    // 1. Missing Token -> 401 Unauthorized
    const unauthRes = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerId: 'hacker-user' }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Authorized with spoofed managerId -> 200, managerId ignored, trusted actor saved
    const authRes = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({ managerId: 'hacker-user-spoofed' }),
    });

    const authText = await authRes.text();
    let authBody: any;
    try {
      authBody = JSON.parse(authText);
    } catch {
      console.error('Failed to parse JSON:', authText);
    }
    if (authRes.status !== 200) {
      console.error('Approval failed with status', authRes.status, authBody);
    }

    assert.equal(authRes.status, 200);
    assert.equal(authBody.data.status, 'APPROVED');
    assert.ok(authBody.data.approvedBy === '00000000-0000-0000-0000-000000000001' || authBody.data.approvedBy === 'dashboard-admin', 'Spoofed managerId must be ignored');

    // 3. Verify chunks created in DB
    const chunkRows = await pool.query(
      'SELECT id, chunk_index, embedding, metadata FROM knowledge_chunks WHERE knowledge_item_id = $1',
      [draft.id]
    );
    assert.ok(chunkRows.rows.length >= 1);
    assert.ok(chunkRows.rows[0].metadata?.contentHash);
    assert.equal(chunkRows.rows[0].metadata?.dimensions, 1536);

    // 4. Verify audit log entry
    const auditRows = await pool.query(
      "SELECT id, action, user_id FROM audit_logs WHERE entity = 'knowledge_items' AND entity_id = $1",
      [draft.id]
    );
    assert.ok(auditRows.rows.length >= 1);
    assert.equal(auditRows.rows[0].action, 'APPROVE_KNOWLEDGE_ITEM');
  });

  it('5. Approved knowledge item is retrieved by AIOrchestrator in runtime pgvector search', async () => {
    const draft = await repos.knowledge.create({
      title: 'STAGE15_2 Maxsus Yetkazib Berish',
      content: 'LImax barcha MDH hududlariga temir yol orqali yuklarni xavfsiz yetkazadi. STAGE15_2',
      language: 'uz',
      status: 'DRAFT',
    });

    // Approve via HTTP
    const approveRes = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });
    assert.equal(approveRes.status, 200);

    const orchestrator = new AIOrchestrator({
      repos,
      aiMode: 'mock',
      embeddingProvider: new MockEmbeddingProvider(),
    });

    const result = await orchestrator.processQuery('LImax MDH temir yol yetkazib berish qanday?');
    assert.ok(result.usedKnowledgeIds.includes(draft.id), 'Approved knowledge must be retrieved by runtime pgvector');
  });

  it('6. PATCH on approved item resetting content reverts status to DRAFT and requires re-approval', async () => {
    const item = await repos.knowledge.create({
      title: 'STAGE15_2 Modifiable Item',
      content: 'Dastlabki matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    // Approve
    await fetch(`${baseUrl}/api/v1/knowledge/${item.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });

    // Modify content via PATCH
    const patchRes = await fetch(`${baseUrl}/api/v1/knowledge/${item.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        content: 'O‘zgartirilgan yangi matn.',
      }),
    });

    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json() as any;
    assert.equal(patchBody.data.status, 'DRAFT', 'Content update on APPROVED item must revert status to DRAFT');
    assert.equal(patchBody.data.approvedBy, null);
  });

  it('7. Idempotent duplicate approval does not generate duplicate chunks or fail', async () => {
    const draft = await repos.knowledge.create({
      title: 'STAGE15_2 Duplicate Approval Item',
      content: 'Idempotent matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    // Approve 1
    const res1 = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });
    assert.equal(res1.status, 200);

    const chunksCount1 = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;

    // Approve 2
    const res2 = await fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });
    assert.equal(res2.status, 200);

    const chunksCount2 = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;
    assert.equal(chunksCount1, chunksCount2, 'Chunk count must remain identical on duplicate approval');
  });

  it('8. Database transaction rolls back completely to DRAFT if an internal step fails', async () => {
    const draft = await repos.knowledge.create({
      title: 'STAGE15_2 Rollback Test Item',
      content: 'Rollback testi uchun matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    // Execute atomic transaction that fails after chunk replacement
    await assert.rejects(
      async () => {
        await withTransaction('postgres', pool, repos, async (txRepos) => {
          await txRepos.knowledge.replaceChunks(draft.id, [
            {
              chunkIndex: 0,
              content: 'Chunk to be rolled back',
              language: 'uz',
              embedding: new Array(1536).fill(0.01),
              metadata: { test: true },
            },
          ]);
          await txRepos.knowledge.update(draft.id, {
            status: 'APPROVED',
            approvedBy: '00000000-0000-0000-0000-000000000001',
          });
          throw new Error('Simulated failure inside approval transaction');
        });
      },
      /Simulated failure inside approval transaction/i
    );

    // Verify DB state: knowledge item must still be DRAFT and chunks must NOT exist
    const itemRow = (await pool.query('SELECT status, approved_by, approved_at FROM knowledge_items WHERE id = $1', [draft.id])).rows[0];
    assert.equal(itemRow.status, 'DRAFT');
    assert.equal(itemRow.approved_by, null);
    assert.equal(itemRow.approved_at, null);

    const chunkCount = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;
    assert.equal(chunkCount, '0', 'Transaction rollback must leave 0 knowledge_chunks in PostgreSQL');
  });

  it('9. Parallel approval requests maintain concurrency safety and avoid duplicate chunks', async () => {
    const draft = await repos.knowledge.create({
      title: 'STAGE15_2 Parallel Approval Item',
      content: 'Parallel approve testi uchun matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    const approvePromise1 = fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });

    const approvePromise2 = fetch(`${baseUrl}/api/v1/knowledge/${draft.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_INTERNAL_TOKEN}`,
      },
    });

    const [res1, res2] = await Promise.all([approvePromise1, approvePromise2]);
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);

    const itemRow = (await pool.query('SELECT status FROM knowledge_items WHERE id = $1', [draft.id])).rows[0];
    assert.equal(itemRow.status, 'APPROVED');

    const chunkCount = (await pool.query('SELECT count(*) FROM knowledge_chunks WHERE knowledge_item_id = $1', [draft.id])).rows[0].count;
    assert.equal(chunkCount, '1', 'Parallel approvals must produce exactly 1 set of chunks');
  });
});
