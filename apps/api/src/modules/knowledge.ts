import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateKnowledgeItemSchema } from '@limax/shared';
import type { IKnowledgeRepository, SupportedLanguage, KnowledgeStatus, KnowledgeItem, Repositories, UserRole } from '@limax/shared';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';
import { chunkKnowledgeContent, createEmbeddingProvider, type EmbeddingProvider } from '@limax/ai-engine';

export async function approveKnowledgeItem(
  repos: Repositories,
  id: string,
  managerId: string = 'manager_user',
  userRole: UserRole = 'ADMIN',
  customEmbeddingProvider?: EmbeddingProvider
): Promise<KnowledgeItem | null> {
  checkPermission(userRole, 'knowledge.approve');

  const existing = await repos.knowledge.findById(id);
  if (!existing) return null;

  // 1. Chunk content deterministically
  const chunks = chunkKnowledgeContent(existing.content);

  // 2. Generate real embeddings before mutating DB
  const embeddingProvider = customEmbeddingProvider || createEmbeddingProvider();
  const chunkTexts = chunks.map((c) => c.content);
  const embeddings = await embeddingProvider.embed(chunkTexts);

  // Validate all embeddings are 1536 finite numbers
  if (embeddings.length !== chunks.length) {
    throw new Error('Embedding count mismatch with chunk count');
  }

  const chunkPayload = chunks.map((c, idx) => ({
    chunkIndex: c.chunkIndex,
    content: c.content,
    language: existing.language,
    embedding: embeddings[idx],
    metadata: {
      title: existing.title,
      source: existing.source,
      chunkIndex: c.chunkIndex,
      totalChunks: chunks.length,
    },
  }));

  // 3. Atomically replace chunks and update status to APPROVED
  await repos.knowledge.replaceChunks(id, chunkPayload);

  const updated = await repos.knowledge.update(id, {
    status: 'APPROVED',
    approvedBy: managerId,
    approvedAt: new Date(),
  });

  if (updated) {
    await logAudit(repos, { userId: managerId, userRole }, 'APPROVE_KNOWLEDGE_ITEM', 'knowledge_items', id, {
      title: updated.title,
      status: updated.status,
      chunkCount: chunks.length,
    });
  }

  return updated;
}

export function createKnowledgeRouter(repo: IKnowledgeRepository, repos?: Repositories): Router {
  const router: Router = Router();

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

  // POST /api/v1/knowledge (Always DRAFT by default)
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = CreateKnowledgeItemSchema.parse(req.body);
      // Force DRAFT on creation
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
      const existing = await repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      // If content modified on APPROVED item, reset to DRAFT requiring re-approval and re-indexing
      const dataToUpdate = { ...req.body };
      if (dataToUpdate.content && dataToUpdate.content !== existing.content && existing.status === 'APPROVED') {
        dataToUpdate.status = 'DRAFT';
        dataToUpdate.approvedBy = null;
        dataToUpdate.approvedAt = null;
      }

      const updated = await repo.update(req.params.id, dataToUpdate);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/knowledge/:id/approve
  router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const managerId = (req.body.managerId as string) || (req as unknown as { user?: { id?: string } }).user?.id || 'admin_user';
      const userRole = (req as unknown as { user?: { role?: UserRole } }).user?.role || 'ADMIN';

      if (repos) {
        const approved = await approveKnowledgeItem(repos, req.params.id, managerId, userRole);
        if (!approved) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
          return;
        }
        res.json({ data: approved });
      } else {
        const item = await repo.findById(req.params.id);
        if (!item) {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
          return;
        }
        const updated = await repo.update(req.params.id, {
          status: 'APPROVED',
          approvedBy: managerId,
          approvedAt: new Date(),
        });
        res.json({ data: updated });
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
