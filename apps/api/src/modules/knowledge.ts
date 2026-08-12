import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateKnowledgeItemSchema } from '@limax/shared';
import type { IKnowledgeRepository, SupportedLanguage, KnowledgeStatus, KnowledgeItem, Repositories, UserRole } from '@limax/shared';
import { randomUUID } from 'crypto';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';

export async function approveKnowledgeItem(
  repos: Repositories,
  id: string,
  managerId: string = 'manager_user',
  userRole: UserRole = 'ADMIN'
): Promise<KnowledgeItem | null> {
  checkPermission(userRole, 'knowledge.approve');

  const existing = await repos.knowledge.findById(id);
  if (!existing) return null;

  const updated = await repos.knowledge.update(id, {
    status: 'APPROVED',
    approvedBy: managerId,
    approvedAt: new Date(),
  });

  if (updated) {
    await logAudit(repos, { userId: managerId, userRole }, 'APPROVE_KNOWLEDGE_ITEM', 'knowledge_items', id, {
      title: updated.title,
      status: updated.status,
    });
  }

  return updated;
}

export function createKnowledgeRouter(repo: IKnowledgeRepository): Router {
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

  // POST /api/v1/knowledge
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = CreateKnowledgeItemSchema.parse(req.body);
      const item = await repo.create(validated);
      res.status(201).json({ data: item });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/knowledge/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await repo.update(req.params.id, req.body);
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
  router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const item = await repo.findById(req.params.id);
      if (!item) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Knowledge item not found' } });
        return;
      }

      const managerId = (req.body.managerId as string) || randomUUID();
      const updated = await repo.update(req.params.id, {
        status: 'APPROVED',
        approvedBy: managerId,
        approvedAt: new Date(),
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
