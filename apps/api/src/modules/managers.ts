import { Router, type Request, type Response, type NextFunction } from 'express';
import type {
  IManagerRepository,
  ILeadRepository,
  IHandoffRepository,
  ManagerStatus,
} from '@limax/shared';

export function createManagersRouter(
  managerRepo: IManagerRepository,
  leadRepo: ILeadRepository,
  handoffRepo: IHandoffRepository,
): Router {
  const router: Router = Router();

  // GET /api/v1/managers
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as ManagerStatus | undefined;
      const onDutyOnly = req.query.onDuty === 'true';

      const [managers, allLeads, allHandoffs] = await Promise.all([
        managerRepo.findAll({ status, onDutyOnly }),
        leadRepo.findAll({}),
        // handoffRepo doesn't have findAll({}), so we can safely compute from leads
        Promise.resolve([]),
      ]);

      // Map real stats to each manager
      const enriched = managers.map((mgr) => {
        const mgrLeads = allLeads.filter((l) => l.assignedManagerId === mgr.id);
        const totalLeads = mgrLeads.length;
        const qualifiedLeads = mgrLeads.filter((l) =>
          l.temperature === 'HOT' ||
          l.temperature === 'WARM' ||
          ['qualifying', 'proposal', 'negotiation', 'won'].includes(l.stage || '')
        ).length;
        const wonDeals = mgrLeads.filter((l) => l.stage === 'won').length;
        const activeHandoffs = mgrLeads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length;
        const conversionRate = totalLeads > 0 ? Math.round((wonDeals / totalLeads) * 100) : 0;
        const qualificationRate = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;

        return {
          ...mgr,
          totalLeads,
          qualifiedLeads,
          qualificationRate,
          wonDeals,
          activeHandoffs,
          conversionRate,
        };
      });

      res.json({
        data: enriched,
        meta: {
          total: managers.length,
          onDutyCount: managers.filter((m) => m.isOnDuty).length,
          activeCount: managers.filter((m) => m.status === 'ACTIVE').length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/managers/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mgr = await managerRepo.findById(req.params.id);
      if (!mgr) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manager not found' } });
        return;
      }

      const allLeads = await leadRepo.findAll({});
      const mgrLeads = allLeads.filter((l) => l.assignedManagerId === mgr.id);
      const totalLeads = mgrLeads.length;
      const qualifiedLeads = mgrLeads.filter((l) =>
        l.temperature === 'HOT' ||
        l.temperature === 'WARM' ||
        ['qualifying', 'proposal', 'negotiation', 'won'].includes(l.stage || '')
      ).length;
      const wonDeals = mgrLeads.filter((l) => l.stage === 'won').length;
      const conversionRate = totalLeads > 0 ? Math.round((wonDeals / totalLeads) * 100) : 0;

      res.json({
        data: {
          ...mgr,
          totalLeads,
          qualifiedLeads,
          wonDeals,
          conversionRate,
          assignedLeads: mgrLeads,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/managers
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, role, phone, telegramUsername, telegramChatId, status, isOnDuty, specialties, maxActiveLeads } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Ism kiritilishi shart' } });
        return;
      }

      const created = await managerRepo.create({
        name: name.trim(),
        role: role || 'Sotuv menejeri',
        phone: phone || undefined,
        telegramUsername: telegramUsername || undefined,
        telegramChatId: telegramChatId || undefined,
        status: status || 'ACTIVE',
        isOnDuty: Boolean(isOnDuty),
        specialties: Array.isArray(specialties) ? specialties : [],
        maxActiveLeads: Number(maxActiveLeads) || 20,
      });

      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/v1/managers/:id
  router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await managerRepo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manager not found' } });
        return;
      }

      const updated = await managerRepo.update(req.params.id, req.body);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/managers/:id/toggle-duty
  router.patch('/:id/toggle-duty', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await managerRepo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manager not found' } });
        return;
      }

      const nextDuty = req.body.isOnDuty !== undefined ? Boolean(req.body.isOnDuty) : !existing.isOnDuty;
      const updated = await managerRepo.setOnDuty(req.params.id, nextDuty);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/managers/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await managerRepo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manager not found' } });
        return;
      }

      await managerRepo.delete(req.params.id);
      res.json({ success: true, message: 'Manager deleted' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/managers/:id/assign-lead
  router.post('/:id/assign-lead', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { leadId } = req.body;
      if (!leadId) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'leadId is required' } });
        return;
      }

      const mgr = await managerRepo.findById(req.params.id);
      if (!mgr) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manager not found' } });
        return;
      }

      const updatedLead = await leadRepo.update(leadId, {
        assignedManagerId: mgr.id,
      });

      res.json({ data: { lead: updatedLead, manager: mgr } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
