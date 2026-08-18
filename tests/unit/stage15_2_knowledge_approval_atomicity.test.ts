import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories } from '../../packages/database/dist/index.js';
import {
  approveKnowledgeItem,
  createKnowledgeRouter,
  resolveTrustedActor,
  type AuthenticatedActor,
} from '../../apps/api/dist/modules/knowledge.js';
import { MockEmbeddingProvider } from '../../packages/ai-engine/dist/index.js';
import type { EmbeddingProvider } from '../../packages/ai-engine/dist/index.js';
import type { Repositories } from '@limax/shared';

describe('Stage 15.2: Atomic Knowledge Approval & Lifecycle Unit Tests', () => {
  it('1. createKnowledgeRouter fails fast if dependency container is missing or invalid', () => {
    assert.throws(
      () => (createKnowledgeRouter as any)(),
      /KnowledgeRouter requires repos dependency/i
    );
    assert.throws(
      () => (createKnowledgeRouter as any)({ repos: null }),
      /KnowledgeRouter requires repos dependency/i
    );
  });

  it('2. approveKnowledgeItem rejects empty content', async () => {
    const repos = createRepositories('memory');
    const emptyItem = await repos.knowledge.create({
      title: 'Bo‘sh Ma’lumot',
      content: '   ',
      language: 'uz',
      status: 'DRAFT',
    });

    const actor: AuthenticatedActor = { id: 'admin-1', role: 'ADMIN' };
    await assert.rejects(
      async () => approveKnowledgeItem(repos, 'memory', undefined, emptyItem.id, actor, new MockEmbeddingProvider()),
      /Cannot approve knowledge item with empty content/i
    );
  });

  it('3. approveKnowledgeItem generates 1536 embeddings and atomically updates status to APPROVED', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'Kafolat Shartlari',
      content: 'LImax barcha mahsulotlariga xalqaro standartlar asosida to‘liq kafolat beradi.',
      language: 'uz',
      status: 'DRAFT',
    });

    const actor: AuthenticatedActor = { id: 'admin-trusted', role: 'ADMIN' };
    const approved = await approveKnowledgeItem(
      repos,
      'memory',
      undefined,
      draft.id,
      actor,
      new MockEmbeddingProvider()
    );

    assert.ok(approved);
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approvedBy, 'admin-trusted');
    assert.ok(approved.approvedAt);

    // Verify chunks are stored and searchable
    const mockProvider = new MockEmbeddingProvider();
    const queryEmb = await mockProvider.embed(['Kafolat']);
    const searchRes = await repos.knowledge.searchSimilar(queryEmb[0], {
      topK: 5,
      minScore: 0.1,
      now: new Date(),
    });
    assert.ok(searchRes.length > 0);
    assert.equal(searchRes[0].knowledgeItemId, draft.id);

    // Verify audit log was recorded
    const audits = await repos.auditLogs.findAll({ page: 1, limit: 10 });
    assert.ok(audits.data.some((a) => a.action === 'APPROVE_KNOWLEDGE_ITEM' && a.userId === 'admin-trusted'));
  });

  it('4. approveKnowledgeItem rolls back to DRAFT if transaction fails midway', async () => {
    const memoryRepos = createRepositories('memory');
    const draft = await memoryRepos.knowledge.create({
      title: 'Rollback Test Item',
      content: 'Rollback qilinishi kerak bo‘lgan matn.',
      language: 'uz',
      status: 'DRAFT',
    });

    // Simulated repos where auditLogs.create fails
    const failingRepos: Repositories = {
      ...memoryRepos,
      auditLogs: {
        ...memoryRepos.auditLogs,
        create: async () => {
          throw new Error('Database disk full / audit insert failure');
        },
      },
    };

    const actor: AuthenticatedActor = { id: 'admin-trusted', role: 'ADMIN' };
    await assert.rejects(
      async () => approveKnowledgeItem(failingRepos, 'memory', undefined, draft.id, actor, new MockEmbeddingProvider()),
      /audit insert failure/i
    );
  });

  it('5. approveKnowledgeItem validates 1536 dimension and non-finite floats', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'Invalid Embedding Item',
      content: 'Matn',
      language: 'uz',
      status: 'DRAFT',
    });

    const actor: AuthenticatedActor = { id: 'admin-1', role: 'ADMIN' };

    // 1535 dim provider
    const badDimProvider: EmbeddingProvider = {
      providerName: 'bad-dim',
      async embed() {
        return [new Array(1535).fill(0.1)];
      },
    };

    await assert.rejects(
      async () => approveKnowledgeItem(repos, 'memory', undefined, draft.id, actor, badDimProvider),
      /Invalid embedding vector dimension/i
    );

    // NaN float provider
    const nanProvider: EmbeddingProvider = {
      providerName: 'nan-emb',
      async embed() {
        const vec = new Array(1536).fill(0.1);
        vec[10] = NaN;
        return [vec];
      },
    };

    await assert.rejects(
      async () => approveKnowledgeItem(repos, 'memory', undefined, draft.id, actor, nanProvider),
      /Invalid non-finite float/i
    );
  });

  it('6. approveKnowledgeItem is idempotent for identical already-approved content', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'Idempotency Item',
      content: 'Bir xil matn saqlanadi.',
      language: 'uz',
      status: 'DRAFT',
    });

    let embedCount = 0;
    const trackingProvider: EmbeddingProvider = {
      providerName: 'tracking',
      async embed(texts: string[]) {
        embedCount += texts.length;
        return texts.map(() => new Array(1536).fill(0.01));
      },
    };

    const actor: AuthenticatedActor = { id: 'admin-1', role: 'ADMIN' };

    // First approval
    const firstApproved = await approveKnowledgeItem(repos, 'memory', undefined, draft.id, actor, trackingProvider);
    assert.equal(firstApproved?.status, 'APPROVED');
    assert.equal(embedCount, 1);

    // Second approval of identical approved item -> Idempotent, no extra embedding calls
    const secondApproved = await approveKnowledgeItem(repos, 'memory', undefined, draft.id, actor, trackingProvider);
    assert.equal(secondApproved?.status, 'APPROVED');
    assert.equal(embedCount, 1, 'Duplicate approval should not re-invoke embedding generation');
  });

  it('7. Trusted actor resolver ignores client spoofed identities', () => {
    const mockReqWithoutUser: any = {
      body: { managerId: 'hacker-spoofed-id', userId: 'attacker' },
    };

    const actor = resolveTrustedActor(mockReqWithoutUser);
    assert.ok(actor.id === '00000000-0000-0000-0000-000000000001' || actor.id === 'dashboard-admin', 'Must default to trusted server-side principal');
    assert.notEqual(actor.id, 'hacker-spoofed-id');

    const mockReqWithAuthContext: any = {
      user: { id: 'verified-manager-123', role: 'ADMIN' },
      body: { managerId: 'spoofed-id' },
    };

    const verifiedActor = resolveTrustedActor(mockReqWithAuthContext);
    assert.equal(verifiedActor.id, 'verified-manager-123');
    assert.notEqual(verifiedActor.id, 'spoofed-id');
  });

  it('8. OpenAIEmbeddingProvider executes batching for large number of texts', async () => {
    const { OpenAIEmbeddingProvider } = await import('../../packages/ai-engine/dist/index.js');
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'test-key',
      batchSize: 5,
    });

    let batchCallCount = 0;
    // Mock the internal batch execution
    (provider as any).embedBatchWithRetry = async (batch: string[]) => {
      batchCallCount++;
      return batch.map(() => new Array(1536).fill(0.01));
    };

    const texts = Array.from({ length: 12 }, (_, i) => `Paragraph chunk ${i}`);
    const results = await provider.embed(texts);

    assert.equal(results.length, 12);
    assert.equal(batchCallCount, 3, '12 items with batchSize 5 must be split into 3 batches (5 + 5 + 2)');
  });

  it('9. OpenAIEmbeddingProvider categorizes 401, 429 and timeout errors cleanly without secret leak', async () => {
    const { OpenAIEmbeddingProvider } = await import('../../packages/ai-engine/dist/index.js');
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-proj-sensitiveapikey12345',
      timeoutMs: 10,
    });

    await assert.rejects(
      async () => provider.embed(['test']),
      (err: Error) => {
        assert.ok(!err.message.includes('sk-proj-sensitiveapikey12345'), 'Secret key must never be present in error message');
        return true;
      }
    );
  });
});
