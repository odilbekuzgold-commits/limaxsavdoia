import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateProductSchema } from '@limax/shared';
import type { IProductRepository } from '@limax/shared';

export function createProductsRouter(repo: IProductRepository): Router {
  const router: Router = Router();

  // GET /api/v1/products
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const category = req.query.category as string | undefined;
      const activeOnly = req.query.active === 'true';
      const all = await repo.findAll({ category, activeOnly });
      res.json({ data: all, meta: { total: all.length } });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/products
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = CreateProductSchema.parse(req.body);
      const product = await repo.create(validated);
      res.status(201).json({ data: product });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/products/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await repo.update(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
