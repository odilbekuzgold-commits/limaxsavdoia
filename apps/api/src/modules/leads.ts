import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ILeadRepository, LeadTemperature } from '@limax/shared';

export function createLeadsRouter(repo: ILeadRepository): Router {
  const router: Router = Router();

  // GET /api/v1/leads
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const temperature = req.query.temperature as LeadTemperature | undefined;
      const stage = req.query.stage as string | undefined;
      const all = await repo.findAll({ temperature, stage });
      res.json({ data: all, meta: { total: all.length } });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/leads/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await repo.update(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Lead not found' } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
