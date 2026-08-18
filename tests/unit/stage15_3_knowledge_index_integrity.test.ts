import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories } from '../../packages/database/dist/index.js';
import { approveKnowledgeItem, resolveTrustedActor } from '../../apps/api/dist/modules/knowledge.js';
import { OpenAIEmbeddingProvider, auditKnowledgeIndex, type EmbeddingProvider } from '../../packages/ai-engine/dist/index.js';
import type { Repositories } from '@limax/shared';

class MockDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'mock';
  readonly modelName = 'text-embedding-3-small';
  public callCount = 0;
  public customDimensions = 1536;

  async embed(texts: string[]): Promise<number[][]> {
    this.callCount++;
    return texts.map(() => new Array(this.customDimensions).fill(0.02));
  }
}

describe('Stage 15.3: Knowledge Index Integrity & Fail-Fast Unit Tests', () => {
  const actor = { id: '00000000-0000-0000-0000-000000000001', role: 'ADMIN' as const };

  it('1. PostgreSQL driver with missing pool fails fast with configuration error', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'PG Fail-Fast Item',
      content: 'Fail-fast test content',
      language: 'uz',
      status: 'DRAFT',
    });

    await assert.rejects(
      async () => {
        await approveKnowledgeItem({
          repos,
          driver: 'postgres',
          pool: undefined, // Missing PG pool
          knowledgeItemId: draft.id,
          actor,
          embeddingProvider: new MockDeterministicEmbeddingProvider(),
        });
      },
      (err: Error) => {
        assert.match(err.message, /requires a PostgreSQL pool/i);
        return true;
      }
    );
  });

  it('2. Explicit memory mode works cleanly without pool', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'Memory Item',
      content: 'Memory test content',
      language: 'uz',
      status: 'DRAFT',
    });

    const provider = new MockDeterministicEmbeddingProvider();
    const approved = await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: draft.id,
      actor,
      embeddingProvider: provider,
    });

    assert.equal(approved?.status, 'APPROVED');
    assert.equal(provider.callCount, 1);

    const indexState = await repos.knowledge.getIndexState(draft.id);
    assert.ok(indexState.chunkCount >= 1);
  });

  it('3. APPROVED item with zero chunks triggers re-indexing', async () => {
    const repos = createRepositories('memory');
    const legacyApproved = await repos.knowledge.create({
      title: 'Legacy Zero Chunk Approved Item',
      content: 'Tizimda avvaldan tasdiqlangan ammo indexlanmagan matn.',
      language: 'uz',
      status: 'APPROVED',
    });

    const provider = new MockDeterministicEmbeddingProvider();
    // Initially index has 0 chunks
    const initialState = await repos.knowledge.getIndexState(legacyApproved.id);
    assert.equal(initialState.chunkCount, 0);

    const reindexed = await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: legacyApproved.id,
      actor,
      embeddingProvider: provider,
    });

    assert.equal(reindexed?.status, 'APPROVED');
    assert.equal(provider.callCount, 1, 'Must invoke embedding provider to backfill zero-chunk item');

    const updatedState = await repos.knowledge.getIndexState(legacyApproved.id);
    assert.ok(updatedState.chunkCount >= 1);
  });

  it('4. APPROVED item with stale contentHash triggers re-indexing', async () => {
    const repos = createRepositories('memory');
    const item = await repos.knowledge.create({
      title: 'Stale Hash Item',
      content: 'Eski matn',
      language: 'uz',
      status: 'APPROVED',
    });

    // Seed with stale hash
    await repos.knowledge.replaceChunks(item.id, [
      {
        chunkIndex: 0,
        content: 'Eski matn',
        language: 'uz',
        embedding: new Array(1536).fill(0.01),
        metadata: {
          contentHash: 'stale_old_sha256_hash',
          dimensions: 1536,
          model: 'text-embedding-3-small',
        },
      },
    ]);

    const provider = new MockDeterministicEmbeddingProvider();
    const reindexed = await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: item.id,
      actor,
      embeddingProvider: provider,
    });

    assert.equal(reindexed?.status, 'APPROVED');
    assert.equal(provider.callCount, 1, 'Stale hash must trigger re-indexing');
  });

  it('5. APPROVED item with wrong dimension metadata triggers re-indexing', async () => {
    const repos = createRepositories('memory');
    const item = await repos.knowledge.create({
      title: 'Wrong Dimension Item',
      content: 'Noto‘g‘ri dimensionli matn',
      language: 'uz',
      status: 'APPROVED',
    });

    await repos.knowledge.replaceChunks(item.id, [
      {
        chunkIndex: 0,
        content: 'Noto‘g‘ri dimensionli matn',
        language: 'uz',
        embedding: new Array(1536).fill(0.01),
        metadata: {
          contentHash: 'some_hash',
          dimensions: 768, // Wrong dimension
          model: 'text-embedding-3-small',
        },
      },
    ]);

    const provider = new MockDeterministicEmbeddingProvider();
    await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: item.id,
      actor,
      embeddingProvider: provider,
    });

    assert.equal(provider.callCount, 1, 'Wrong dimension must trigger re-indexing');
  });

  it('6. APPROVED item with healthy index is strictly idempotent (0 embedding calls)', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'Healthy Index Item',
      content: 'Sog‘lom indekslangan ma’lumot',
      language: 'uz',
      status: 'DRAFT',
    });

    const provider = new MockDeterministicEmbeddingProvider();
    // First approval
    const approved = await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: draft.id,
      actor,
      embeddingProvider: provider,
    });
    assert.equal(approved?.status, 'APPROVED');
    assert.equal(provider.callCount, 1);

    // Second approval of healthy index
    const secondCall = await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: draft.id,
      actor,
      embeddingProvider: provider,
    });
    assert.equal(secondCall?.status, 'APPROVED');
    assert.equal(provider.callCount, 1, 'Healthy index must be idempotent with 0 additional embedding calls');
  });

  it('7. auditKnowledgeIndex detects issues accurately', async () => {
    const repos = createRepositories('memory');

    // Item 1: Missing chunks
    await repos.knowledge.create({
      title: 'No Chunks Item',
      content: 'Some text',
      language: 'uz',
      status: 'APPROVED',
    });

    // Item 2: Healthy item
    const healthyDraft = await repos.knowledge.create({
      title: 'Healthy Item',
      content: 'Healthy text',
      language: 'uz',
      status: 'DRAFT',
    });
    await approveKnowledgeItem({
      repos,
      driver: 'memory',
      knowledgeItemId: healthyDraft.id,
      actor,
      embeddingProvider: new MockDeterministicEmbeddingProvider(),
    });

    const report = await auditKnowledgeIndex(repos, new MockDeterministicEmbeddingProvider());
    assert.equal(report.totalApproved, 2);
    assert.equal(report.missingChunks, 1);
    assert.equal(report.healthyIndexed, 1);
    assert.equal(report.requiresReindex, 1);
  });

  it('8. OpenAIEmbeddingProvider bounded retry on transient 429 and 503 errors', async () => {
    let sleepCalls: number[] = [];
    const mockSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    let fetchAttempts = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_url: any, _opts: any) => {
      fetchAttempts++;
      if (fetchAttempts === 1) {
        return new Response(JSON.stringify({ error: 'Rate limit' }), {
          status: 429,
          headers: { 'retry-after': '0.05' },
        });
      }
      if (fetchAttempts === 2) {
        return new Response(JSON.stringify({ error: 'Server error' }), {
          status: 503,
        });
      }
      return new Response(
        JSON.stringify({
          data: [{ embedding: new Array(1536).fill(0.01), index: 0 }],
        }),
        { status: 200 }
      );
    }) as any;

    try {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: 'test-key',
        sleepFn: mockSleep,
        maxRetries: 3,
      });

      const result = await provider.embed(['Test retry text']);
      assert.equal(result.length, 1);
      assert.equal(fetchAttempts, 3, 'Must attempt 3 times and succeed on the 3rd attempt');
      assert.ok(sleepCalls.length >= 2, 'Must sleep between retries');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('9. OpenAIEmbeddingProvider does NOT retry on non-transient 401 auth error', async () => {
    let fetchAttempts = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_url: any, _opts: any) => {
      fetchAttempts++;
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }) as any;

    try {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: 'sk-proj-invalidkey123',
        maxRetries: 3,
      });

      await assert.rejects(
        async () => provider.embed(['Test text']),
        (err: Error) => {
          assert.match(err.message, /OPENAI_AUTH_FAILED/i);
          assert.ok(!err.message.includes('sk-proj-invalidkey123'), 'Secrets must never leak into error message');
          return true;
        }
      );
      assert.equal(fetchAttempts, 1, 'Must fail immediately without retries on 401');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('10. OpenAIEmbeddingProvider does NOT retry on dimension mismatch error', async () => {
    let fetchAttempts = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_url: any, _opts: any) => {
      fetchAttempts++;
      return new Response(
        JSON.stringify({
          data: [{ embedding: new Array(512).fill(0.01), index: 0 }],
        }),
        { status: 200 }
      );
    }) as any;

    try {
      const provider = new OpenAIEmbeddingProvider({
        apiKey: 'test-key',
        dimensions: 1536,
        maxRetries: 3,
      });

      await assert.rejects(
        async () => provider.embed(['Dimension test']),
        (err: Error) => {
          assert.match(err.message, /dimension mismatch/i);
          return true;
        }
      );
      assert.equal(fetchAttempts, 1, 'Dimension mismatch must fail fast without retry');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
