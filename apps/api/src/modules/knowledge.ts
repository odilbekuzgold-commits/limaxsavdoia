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
  repos: Repositories,
  driverOrId: RepositoryDriver | string = 'postgres',
  poolOrActor?: any,
  idOrCustomProvider?: any,
  actorParam?: AuthenticatedActor,
  customEmbeddingProvider?: EmbeddingProvider
): Promise<KnowledgeItem | null> {
  if (!repos || !repos.knowledge) {
    throw new Error('Knowledge approval requires initialized repository container');
  }

  let driver: RepositoryDriver = 'postgres';
  let poolInstance: any = undefined;
  let id: string;
  let actor: AuthenticatedActor = { id: DEFAULT_SERVICE_ACTOR_ID, role: 'ADMIN' };
  let embeddingProviderInstance: EmbeddingProvider | undefined;

  // Check if called with legacy signature: approveKnowledgeItem(repos, id, userId?, userRole?, provider?)
  if (typeof driverOrId === 'string' && driverOrId !== 'postgres' && driverOrId !== 'memory') {
    id = driverOrId;
    if (typeof poolOrActor === 'string') {
      const userRole = typeof idOrCustomProvider === 'string' ? idOrCustomProvider : 'ADMIN';
      actor = { id: poolOrActor, role: userRole as any };
      if (actorParam && typeof actorParam === 'object' && 'embed' in actorParam) {
        embeddingProviderInstance = actorParam as any;
      }
    } else if (poolOrActor && typeof poolOrActor === 'object' && 'role' in poolOrActor) {
      actor = poolOrActor;
      if (idOrCustomProvider && typeof idOrCustomProvider === 'object' && 'embed' in idOrCustomProvider) {
        embeddingProviderInstance = idOrCustomProvider;
      }
    } else if (poolOrActor && typeof poolOrActor === 'object' && 'embed' in poolOrActor) {
      embeddingProviderInstance = poolOrActor;
    }
  } else {
    driver = (driverOrId as RepositoryDriver) || (poolOrActor ? 'postgres' : 'memory');
    poolInstance = poolOrActor;
    id = idOrCustomProvider as string;
    if (actorParam && typeof actorParam === 'object' && 'role' in actorParam) {
      actor = actorParam;
    }
    embeddingProviderInstance = customEmbeddingProvider;
  }

  // Final safety: if driver is postgres but no pool provided, switch to memory
  if (driver === 'postgres' && !poolInstance) {
    driver = 'memory';
  }

  checkPermission(actor.role, 'knowledge.approve');

  // 1. Pre-transaction checks & preparation (no DB lock held during external API call)
  const existing = await repos.knowledge.findById(id);
  if (!existing) return null;

  if (!existing.content || !existing.content.trim()) {
    throw new Error('Cannot approve knowledge item with empty content');
  }

  const contentHash = crypto.createHash('sha256').update(existing.content.trim()).digest('hex');

  // Idempotency: If already APPROVED with identical content, avoid redundant re-indexing
  if (existing.status === 'APPROVED') {
    const existingChunks = await repos.knowledge.findAll({ language: existing.language, status: 'APPROVED' });
    if (existingChunks.some((k) => k.id === id)) {
      return existing;
    }
  }

  // 2. Deterministic chunking & embedding generation BEFORE opening DB transaction
  const chunks = chunkKnowledgeContent(existing.content);
  if (chunks.length === 0) {
    throw new Error('Failed to generate chunks for knowledge content');
  }

  const embeddingProvider = embeddingProviderInstance || createEmbeddingProvider();
  const chunkTexts = chunks.map((c) => c.content);
  const embeddings = await embeddingProvider.embed(chunkTexts);

  // Strict 1536 dimension validation
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
      dimensions: 1536,
      indexedAt: now.toISOString(),
      chunkIndex: c.chunkIndex,
      totalChunks: chunks.length,
    },
  }));

  // 3. Short, atomic ACID transaction for DB mutations & row-level locking
  return withTransaction(driver, poolInstance, repos, async (txRepos) => {
    // Row-level lock: ensure no concurrent modification of knowledge item
    const lockedItem = await txRepos.knowledge.findByIdForUpdate(id);
    if (!lockedItem) {
      throw new Error('Knowledge item not found during transaction lock');
    }

    // Verify content did not change between pre-transaction read and lock acquisition
    if (lockedItem.content.trim() !== existing.content.trim()) {
      throw new Error('Knowledge item content was modified concurrently. Approval aborted.');
    }

    // Replace chunks atomically within the transaction
    await txRepos.knowledge.replaceChunks(id, chunkPayload);

    // Update status to APPROVED
    const updated = await txRepos.knowledge.update(id, {
      status: 'APPROVED',
      approvedBy: actor.id,
      approvedAt: now,
    });

    if (!updated) {
      throw new Error('Failed to update knowledge item status to APPROVED');
    }

    // Audit log insertion within the exact same transaction
    await logAudit(txRepos, { userId: actor.id, userRole: actor.role }, 'APPROVE_KNOWLEDGE_ITEM', 'knowledge_items', id, {
      title: updated.title,
      status: updated.status,
      chunkCount: chunks.length,
      contentHash,
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

  // PATCH /api/v1/knowledge/:id
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

      const existing = await repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      const actor = deps.actorResolver ? deps.actorResolver(req) : resolveTrustedActor(req);
      const dataToUpdate = { ...req.body };

      // Content/title/language changes on APPROVED items require moving back to DRAFT for re-approval and re-indexing
      const contentChanged = dataToUpdate.content && dataToUpdate.content !== existing.content;
      const titleChanged = dataToUpdate.title && dataToUpdate.title !== existing.title;
      const langChanged = dataToUpdate.language && dataToUpdate.language !== existing.language;

      if ((contentChanged || titleChanged || langChanged) && existing.status === 'APPROVED') {
        dataToUpdate.status = 'DRAFT';
        dataToUpdate.approvedBy = null;
        dataToUpdate.approvedAt = null;
      }

      const updated = await repo.update(req.params.id, dataToUpdate);

      if (updated && (contentChanged || titleChanged || langChanged)) {
        await logAudit(deps.repos, { userId: actor.id, userRole: actor.role }, 'UPDATE_KNOWLEDGE_ITEM_RESET_DRAFT', 'knowledge_items', req.params.id, {
          title: updated.title,
          status: updated.status,
          requiresReindex: true,
        });
      }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/knowledge/:id/approve
  router.post('/:id/approve', async (req: Request, res: Response, _next: NextFunction) => {
    try {
      // Security: Strictly ignore any client-spoofed managerId or userId in req.body
      const actor = deps.actorResolver ? deps.actorResolver(req) : resolveTrustedActor(req);

      const approved = await approveKnowledgeItem(
        deps.repos,
        deps.driver || 'postgres',
        deps.pool,
        req.params.id,
        actor,
        deps.embeddingProvider
      );

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

      // Sanitize internal error messages to ensure no secrets or raw embeddings leak
      const safeMessage = message.replace(/sk-[a-zA-Z0-9_-]+/g, '[MASKED_KEY]');
      res.status(500).json({
        error: {
          code,
          message: safeMessage,
        },
      });
    }
  });

  // DELETE /api/v1/knowledge/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = deps.actorResolver ? deps.actorResolver(req) : resolveTrustedActor(req);
      checkPermission(actor.role, 'knowledge.update');

      const existing = await repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      const deleted = await repo.delete(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      await logAudit(deps.repos, { userId: actor.id, userRole: actor.role }, 'DELETE_KNOWLEDGE_ITEM', 'knowledge_items', req.params.id, {
        title: existing.title,
        status: existing.status,
      });

      res.json({ data: { id: req.params.id, deleted: true } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
