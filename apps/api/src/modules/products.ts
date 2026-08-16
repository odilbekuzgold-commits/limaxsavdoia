import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateProductSchema } from '@limax/shared';
import type { Repositories, IProductRepository } from '@limax/shared';
import { logAudit } from '../common/middleware/audit.js';

export function createProductsRouter(reposOrRepo: Repositories | IProductRepository): Router {
  const router: Router = Router();
  const repo: IProductRepository = 'products' in reposOrRepo ? reposOrRepo.products : reposOrRepo;
  const repos: Repositories | null = 'products' in reposOrRepo ? reposOrRepo : null;

  // GET /api/v1/products
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const category = req.query.category as string | undefined;
      const activeOnly = req.query.active === 'true' || req.query.activeOnly === 'true';
      const all = await repo.findAll({ category, activeOnly });
      res.json({ data: all, meta: { total: all.length } });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/products/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const product = await repo.findById(req.params.id);
      if (!product) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      res.json({ data: product });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/products
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const code = (body.code || '').trim();
      const name = (body.name || '').trim();

      if (!name) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Product name cannot be empty' } });
        return;
      }

      // Duplicate code check if code is specified
      if (code) {
        const allProducts = await repo.findAll({});
        const duplicate = allProducts.find(
          (p) => p.code && p.code.trim().toLowerCase() === code.toLowerCase()
        );
        if (duplicate) {
          res.status(409).json({ error: { code: 'DUPLICATE_CODE', message: `Product code "${code}" already exists` } });
          return;
        }
      }

      const validated = CreateProductSchema.parse({
        ...body,
        name,
        code: code || undefined,
        category: body.category || 'General',
        description: body.description || name,
        price: typeof body.price === 'number' ? body.price : 0,
        currency: body.currency || 'USD',
        active: body.active !== undefined ? Boolean(body.active) : true,
      });

      const product = await repo.create(validated);

      if (repos) {
        await logAudit(repos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'CREATE_PRODUCT', 'products', product.id, {
          name: product.name,
          code: product.code,
          active: product.active,
        });
      }

      res.status(201).json({ data: product });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/products/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }

      const updated = await repo.update(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }

      if (repos) {
        await logAudit(repos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'UPDATE_PRODUCT', 'products', req.params.id, {
          oldValue: existing,
          newValue: updated,
        });
      }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/products/:id/deactivate
  router.post('/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }

      const updated = await repo.update(req.params.id, { active: false });

      if (repos) {
        await logAudit(repos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'DEACTIVATE_PRODUCT', 'products', req.params.id, {
          active: false,
        });
      }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/products/:id/activate
  router.post('/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }

      const updated = await repo.update(req.params.id, { active: true });

      if (repos) {
        await logAudit(repos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'ACTIVATE_PRODUCT', 'products', req.params.id, {
          active: true,
        });
      }

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
