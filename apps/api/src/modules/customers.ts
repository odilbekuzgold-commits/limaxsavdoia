import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateCustomerSchema } from '@limax/shared';
import type { ICustomerRepository } from '@limax/shared';

export function createCustomersRouter(repo: ICustomerRepository): Router {
  const router: Router = Router();

  // GET /api/v1/customers
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '10', 10);
      const search = (req.query.search as string) || undefined;

      const result = await repo.findAll({ page, limit, search });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/customers
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = CreateCustomerSchema.parse(req.body);
      const customer = await repo.create(validated);
      res.status(201).json({ data: customer });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/customers/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customer = await repo.findById(req.params.id);
      if (!customer) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } });
        return;
      }
      res.json({ data: customer });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/customers/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await repo.update(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
