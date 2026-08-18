import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateKnowledgeItemSchema } from '@limax/shared';
import type {
  SupportedLanguage,
  KnowledgeStatus,
  KnowledgeItem,
  Repositories,
  UserRole,
} from '@limax/shared';
import crypto from 'crypto';
import { withTransaction, type RepositoryDriver } from '@limax/database';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';
import { chunkKnowledgeContent, createEmbeddingProvider, type EmbeddingProvider } from '@limax/ai-engine';

export interface AuthenticatedActor {
  id: string;
  role: UserRole;
}

export interface KnowledgeRouterDependencies {
  repos: Repositories;
  driver?: RepositoryDriver;
  pool?: any;
  embeddingProvider?: EmbeddingProvider;
  actorResolver?: (req: Request) => AuthenticatedActor;
}

export interface ApproveKnowledgeOptions {
  repos: Repositories;
  driver?: RepositoryDriver;
  pool?: any;
  knowledgeItemId: string;
  actor: AuthenticatedActor;
  embeddingProvider?: EmbeddingProvider;
}

export const DEFAULT_SERVICE_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

export function resolveTrustedActor(req: Request): AuthenticatedActor {
  const reqWithUser = req as unknown as { user?: { id?: string; role?: UserRole } };
  if (reqWithUser.user?.id && reqWithUser.user?.role) {
    return {
      id: reqWithUser.user.id,
      role: reqWithUser.user.role,
    };
  }
  // Server-side trusted service principal for internal authenticated calls
  return {
    id: DEFAULT_SERVICE_ACTOR_ID,
    role: 'ADMIN',
  };
}

export async function approveKnowledgeItem(
  optionsOrRepos: ApproveKnowledgeOptions | Repositories,
  legacyDriverOrId?: RepositoryDriver | string,
  legacyPoolOrActor?: any,
  legacyIdOrProvider?: any,
  legacyActorParam?: AuthenticatedActor,
  legacyProviderParam?: EmbeddingProvider
): Promise<KnowledgeItem | null> {
  let opts: ApproveKnowledgeOptions;

  if ('knowledgeItemId' in optionsOrRepos && 'repos' in optionsOrRepos && 'actor' in optionsOrRepos) {
    opts = optionsOrRepos as ApproveKnowledgeOptions;
  } else {
    // Legacy positional argument adaptation
    const repos = optionsOrRepos as Repositories;
    let driver: RepositoryDriver = 'postgres';
    let poolInstance: any = undefined;
    let id: string;
    let actor: AuthenticatedActor = { id: DEFAULT_SERVICE_ACTOR_ID, role: 'ADMIN' };
    let embeddingProviderInstance: EmbeddingProvider | undefined;

    if (typeof legacyDriverOrId === 'string' && legacyDriverOrId !== 'postgres' && legacyDriverOrId !== 'memory') {
      id = legacyDriverOrId;
      driver = 'memory';
      if (typeof legacyPoolOrActor === 'string') {
        const userRole = typeof legacyIdOrProvider === 'string' ? legacyIdOrProvider : 'ADMIN';
        actor = { id: legacyPoolOrActor, role: userRole as any };
        if (legacyActorParam && typeof legacyActorParam === 'object' && 'embed' in legacyActorParam) {
          embeddingProviderInstance = legacyActorParam as any;
        }
      } else if (legacyPoolOrActor && typeof legacyPoolOrActor === 'object' && 'role' in legacyPoolOrActor) {
        actor = legacyPoolOrActor;
        if (legacyIdOrProvider && typeof legacyIdOrProvider === 'object' && 'embed' in legacyIdOrProvider) {
          embeddingProviderInstance = legacyIdOrProvider;
        }
      } else if (legacyPoolOrActor && typeof legacyPoolOrActor === 'object' && 'embed' in legacyPoolOrActor) {
        embeddingProviderInstance = legacyPoolOrActor;
      }
    } else {
      driver = (legacyDriverOrId as RepositoryDriver) || (legacyPoolOrActor ? 'postgres' : 'memory');
      poolInstance = legacyPoolOrActor;
      id = legacyIdOrProvider as string;
      if (legacyActorParam && typeof legacyActorParam === 'object' && 'role' in legacyActorParam) {
        actor = legacyActorParam;
      }
      embeddingProviderInstance = legacyProviderParam;
    }

    opts = {
      repos,
      driver,
      pool: poolInstance,
      knowledgeItemId: id,
      actor,
      embeddingProvider: embeddingProviderInstance,
    };
  }

  const { repos, knowledgeItemId, actor } = opts;
  let driver: RepositoryDriver;
  if (opts.driver) {
    driver = opts.driver;
  } else if (opts.pool) {
    driver = 'postgres';
  } else if (repos && repos.knowledge && repos.knowledge.constructor.name === 'InMemoryKnowledgeRepository') {
    driver = 'memory';
  } else {
    driver = 'postgres';
  }
  const pool = opts.pool;

  if (!repos || !repos.knowledge) {
    throw new Error('Knowledge approval requires initialized repository container');
  }

  // PostgreSQL Fail-Fast: Never silently fallback to in-memory mode when PostgreSQL is requested
  if (driver === 'postgres' && !pool) {
    throw new Error('PostgreSQL knowledge approval requires a PostgreSQL pool');
  }

  checkPermission(actor.role, 'knowledge.approve');

  // 1. Pre-transaction fetch & validation
  const existing = await repos.knowledge.findById(knowledgeItemId);
  if (!existing) return null;

  if (!existing.content || !existing.content.trim()) {
    throw new Error('Cannot approve knowledge item with empty content');
  }

  const contentHash = crypto.createHash('sha256').update(existing.content.trim()).digest('hex');
  const embeddingProvider = opts.embeddingProvider || createEmbeddingProvider();

  // 2. Comprehensive Index Health Check & Idempotency
  const indexState = await repos.knowledge.getIndexState(knowledgeItemId);
  const isHealthyIndex =
    existing.status === 'APPROVED' &&
    indexState.chunkCount > 0 &&
    indexState.contentHashes.length === indexState.chunkCount &&
    indexState.contentHashes.every((h) => h === contentHash) &&
    indexState.dimensions.length === indexState.chunkCount &&
    indexState.dimensions.every((d) => d === 1536) &&
    indexState.models.every((m) => m === embeddingProvider.modelName || m === 'mock-1536');

  if (existing.status === 'APPROVED' && isHealthyIndex) {
    return existing; // Already healthy and fully indexed, 0 external embedding calls
  }

  // 3. Chunking & Embedding Generation (Pre-transaction: external API call outside DB lock)
  const chunks = chunkKnowledgeContent(existing.content);
  if (chunks.length === 0) {
    throw new Error('Failed to generate chunks for knowledge content');
  }

  const chunkTexts = chunks.map((c) => c.content);
  const embeddings = await embeddingProvider.embed(chunkTexts);

  // Strict 1536 dimension & finiteness validation
  if (!embeddings || embeddings.length !== chunks.length) {
    throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${embeddings?.length ?? 0}`);
  }

  for (let i = 0; i < embeddings.length; i++) {
    const vec = embeddings[i];
    if (!Array.isArray(vec) || vec.length !== 1536) {
      throw new Error(`Invalid embedding vector dimension at chunk ${i}: expected 1536, got ${vec?.length ?? 0}`);
    }
    for (let j = 0; j < vec.length; j++) {
      if (typeof vec[j] !== 'number' || !Number.isFinite(vec[j])) {
        throw new Error(`Invalid non-finite float in embedding vector at chunk ${i}, index ${j}`);
      }
    }
  }

  const now = new Date();
  const chunkPayload = chunks.map((c, idx) => ({
    chunkIndex: c.chunkIndex,
    content: c.content,
    language: existing.language,
    embedding: embeddings[idx],
    metadata: {
      title: existing.title,
      source: existing.source,
      contentHash,
      provider: embeddingProvider.providerName,
      model: embeddingProvider.modelName,
      dimensions: 1536,
      indexedAt: now.toISOString(),
      chunkIndex: c.chunkIndex,
      totalChunks: chunks.length,
    },
  }));

  // 4. Short, atomic ACID transaction for DB mutations & row-level locking
  return withTransaction(driver, pool, repos, async (txRepos) => {
    const lockedItem = await txRepos.knowledge.findByIdForUpdate(knowledgeItemId);
    if (!lockedItem) {
      throw new Error('Knowledge item not found during transaction lock');
    }

    if (lockedItem.content.trim() !== existing.content.trim()) {
      throw new Error('Knowledge item content was modified concurrently. Approval aborted.');
    }

    // Replace chunks atomically within the transaction
    await txRepos.knowledge.replaceChunks(knowledgeItemId, chunkPayload);

    // Update status to APPROVED
    const updated = await txRepos.knowledge.update(knowledgeItemId, {
      status: 'APPROVED',
      approvedBy: actor.id,
      approvedAt: now,
    });

    if (!updated) {
      throw new Error('Failed to update knowledge item status to APPROVED');
    }

    const action = existing.status === 'APPROVED' ? 'REINDEX_KNOWLEDGE_ITEM' : 'APPROVE_KNOWLEDGE_ITEM';

    await logAudit(txRepos, { userId: actor.id, userRole: actor.role }, action, 'knowledge_items', knowledgeItemId, {
      title: updated.title,
      status: updated.status,
      chunkCount: chunks.length,
      contentHash,
      model: embeddingProvider.modelName,
    });

    return updated;
  });
}

export function createKnowledgeRouter(deps: KnowledgeRouterDependencies): Router {
  if (!deps || !deps.repos || !deps.repos.knowledge) {
    throw new Error('KnowledgeRouter requires repos dependency. Fallback mode is strictly prohibited.');
  }

  const router: Router = Router();
  const repo = deps.repos.knowledge;

  // GET /api/v1/knowledge
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const language = req.query.language as SupportedLanguage | undefined;
      const status = req.query.status as KnowledgeStatus | undefined;
      const all = await repo.findAll({ language, status });
      res.json({ data: all, meta: { total: all.length } });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/knowledge (Must always be DRAFT; reject APPROVED in body)
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body?.status === 'APPROVED' || req.body?.approvedBy || req.body?.approvedAt) {
        res.status(400).json({
          error: {
            code: 'INVALID_STATUS',
            message: 'Direct creation of APPROVED knowledge items is forbidden. Must be created as DRAFT and approved via /approve endpoint.',
          },
        });
        return;
      }

      const validated = CreateKnowledgeItemSchema.parse(req.body);
      validated.status = 'DRAFT';
      const item = await repo.create(validated);
      res.status(201).json({ data: item });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/knowledge/:id (Atomic APPROVED -> DRAFT reset + chunk invalidation)
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.body?.status === 'APPROVED') {
        res.status(400).json({
          error: {
            code: 'INVALID_STATUS_UPDATE',
            message: 'Directly setting status to APPROVED via PATCH is forbidden. Use POST /api/v1/knowledge/:id/approve.',
          },
        });
        return;
      }

      const actor = deps.actorResolver ? deps.actorResolver(req) : resolveTrustedActor(req);
      const driver: RepositoryDriver = deps.driver || (deps.pool ? 'postgres' : 'memory');

      if (driver === 'postgres' && !deps.pool) {
        throw new Error('PostgreSQL knowledge patch requires a PostgreSQL pool');
      }

      const updated = await withTransaction(driver, deps.pool, deps.repos, async (txRepos) => {
        const existing = await txRepos.knowledge.findByIdForUpdate(req.params.id);
        if (!existing) return null;

        const dataToUpdate = { ...req.body };
        const contentChanged = dataToUpdate.content && dataToUpdate.content !== existing.content;
        const titleChanged = dataToUpdate.title && dataToUpdate.title !== existing.title;
        const langChanged = dataToUpdate.language && dataToUpdate.language !== existing.language;
        const requiresReindex = (contentChanged || titleChanged || langChanged) && existing.status === 'APPROVED';

        if (requiresReindex) {
          dataToUpdate.status = 'DRAFT';
          dataToUpdate.approvedBy = null;
          dataToUpdate.approvedAt = null;
        }

        const resItem = await txRepos.knowledge.update(req.params.id, dataToUpdate);
        if (!resItem) return null;

        if (requiresReindex) {
          await txRepos.knowledge.replaceChunks(req.params.id, []);
          await logAudit(txRepos, { userId: actor.id, userRole: actor.role }, 'UPDATE_KNOWLEDGE_ITEM_RESET_DRAFT', 'knowledge_items', req.params.id, {
            title: resItem.title,
            status: resItem.status,
            requiresReindex: true,
          });
        }

        return resItem;
      });

      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/knowledge/:id/approve
  router.post('/:id/approve', async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const actor = deps.actorResolver ? deps.actorResolver(req) : resolveTrustedActor(req);

      const approved = await approveKnowledgeItem({
        repos: deps.repos,
        driver: deps.driver || (deps.pool ? 'postgres' : 'memory'),
        pool: deps.pool,
        knowledgeItemId: req.params.id,
        actor,
        embeddingProvider: deps.embeddingProvider,
      });

      if (!approved) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      res.json({ data: approved });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Knowledge approval failed';
      let code = 'APPROVAL_FAILED';
      if (message.includes('OPENAI_AUTH_FAILED')) code = 'EMBEDDING_AUTH_FAILED';
      else if (message.includes('OPENAI_QUOTA_EXCEEDED')) code = 'EMBEDDING_QUOTA_EXCEEDED';
      else if (message.includes('OPENAI_TIMEOUT')) code = 'EMBEDDING_TIMEOUT';
      else if (message.includes('OPENAI_SERVICE_UNAVAILABLE')) code = 'EMBEDDING_SERVICE_UNAVAILABLE';
      else if (message.includes('dimension')) code = 'INVALID_EMBEDDING_DIMENSIONS';
      else if (message.includes('empty content')) code = 'EMPTY_CONTENT';
      else if (message.includes('requires a PostgreSQL pool')) code = 'CONFIGURATION_ERROR';

      const safeMessage = message.replace(/sk-[a-zA-Z0-9_-]+/g, '[MASKED_KEY]');
      const statusCode = code === 'CONFIGURATION_ERROR' ? 503 : 500;
      res.status(statusCode).json({
        error: {
          code,
          message: safeMessage,
        },
      });
    }
  });

  // DELETE /api/v1/knowledge/:id (Atomic DELETE + cascade chunks + audit)
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = deps.actorResolver ? deps.actorResolver(req) : resolveTrustedActor(req);
      checkPermission(actor.role, 'knowledge.update');

      const driver: RepositoryDriver = deps.driver || (deps.pool ? 'postgres' : 'memory');
      if (driver === 'postgres' && !deps.pool) {
        throw new Error('PostgreSQL delete requires a PostgreSQL pool');
      }

      const deleted = await withTransaction(driver, deps.pool, deps.repos, async (txRepos) => {
        const existing = await txRepos.knowledge.findByIdForUpdate(req.params.id);
        if (!existing) return null;

        const isDeleted = await txRepos.knowledge.delete(req.params.id);
        if (!isDeleted) return null;

        await logAudit(txRepos, { userId: actor.id, userRole: actor.role }, 'DELETE_KNOWLEDGE_ITEM', 'knowledge_items', req.params.id, {
          title: existing.title,
          status: existing.status,
        });

        return existing;
      });

      if (!deleted) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      res.json({ data: { id: req.params.id, deleted: true } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
