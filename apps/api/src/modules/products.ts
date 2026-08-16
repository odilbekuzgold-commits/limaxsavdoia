import { Router, type Request, type Response, type NextFunction } from 'express';
import { CreateProductSchema } from '@limax/shared';
import type { Repositories, IProductRepository } from '@limax/shared';
import { withTransaction, type RepositoryDriver } from '@limax/database';
import { logAudit } from '../common/middleware/audit.js';

export function createProductsRouter(
  reposOrRepo: Repositories | IProductRepository,
  driver: RepositoryDriver = 'memory',
  pool?: any
): Router {
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

  // POST /api/v1/products (Atomic Transaction)
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body || {};
      const code = (body.code || '').trim();
      const name = (body.name || '').trim();

      if (!name) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Product name cannot be empty' } });
        return;
      }

      const exec = async (targetRepos: Repositories) => {
        if (code) {
          const allProducts = await targetRepos.products.findAll({});
          const duplicate = allProducts.find(
            (p) => p.code && p.code.trim().toLowerCase() === code.toLowerCase()
          );
          if (duplicate) {
            const err = new Error(`Product code "${code}" already exists`);
            (err as unknown as { statusCode: number }).statusCode = 409;
            throw err;
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

        const product = await targetRepos.products.create(validated);

        await logAudit(targetRepos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'CREATE_PRODUCT', 'products', product.id, {
          name: product.name,
          code: product.code,
          active: product.active,
        });

        return product;
      };

      const product = repos ? await withTransaction(driver, pool, repos, exec) : await exec({ products: repo } as Repositories);
      res.status(201).json({ data: product });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as unknown as { statusCode?: number }).statusCode;
      if (code === 409 || msg.includes('already exists')) {
        res.status(409).json({ error: { code: 'DUPLICATE_CODE', message: msg } });
        return;
      }
      next(err);
    }
  });

  // PATCH /api/v1/products/:id (Atomic Transaction)
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const exec = async (targetRepos: Repositories) => {
        const existing = await targetRepos.products.findById(req.params.id);
        if (!existing) {
          const err = new Error('Product not found');
          (err as unknown as { statusCode: number }).statusCode = 404;
          throw err;
        }

        const updated = await targetRepos.products.update(req.params.id, req.body);
        if (!updated) {
          const err = new Error('Product not found');
          (err as unknown as { statusCode: number }).statusCode = 404;
          throw err;
        }

        await logAudit(targetRepos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'UPDATE_PRODUCT', 'products', req.params.id, {
          oldValue: existing,
          newValue: updated,
        });

        return updated;
      };

      const updated = repos ? await withTransaction(driver, pool, repos, exec) : await exec({ products: repo } as Repositories);
      res.json({ data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as unknown as { statusCode?: number }).statusCode;
      if (code === 404 || msg.includes('Product not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      next(err);
    }
  });

  // POST /api/v1/products/:id/deactivate (Atomic Transaction)
  router.post('/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const exec = async (targetRepos: Repositories) => {
        const existing = await targetRepos.products.findById(req.params.id);
        if (!existing) {
          const err = new Error('Product not found');
          (err as unknown as { statusCode: number }).statusCode = 404;
          throw err;
        }

        const updated = await targetRepos.products.update(req.params.id, { active: false });

        await logAudit(targetRepos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'DEACTIVATE_PRODUCT', 'products', req.params.id, {
          active: false,
        });

        return updated;
      };

      const updated = repos ? await withTransaction(driver, pool, repos, exec) : await exec({ products: repo } as Repositories);
      res.json({ data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as unknown as { statusCode?: number }).statusCode;
      if (code === 404 || msg.includes('Product not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      next(err);
    }
  });

  // POST /api/v1/products/:id/activate (Atomic Transaction)
  router.post('/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const exec = async (targetRepos: Repositories) => {
        const existing = await targetRepos.products.findById(req.params.id);
        if (!existing) {
          const err = new Error('Product not found');
          (err as unknown as { statusCode: number }).statusCode = 404;
          throw err;
        }

        const updated = await targetRepos.products.update(req.params.id, { active: true });

        await logAudit(targetRepos, { userId: 'dashboard-admin', userRole: 'ADMIN' }, 'ACTIVATE_PRODUCT', 'products', req.params.id, {
          active: true,
        });

        return updated;
      };

      const updated = repos ? await withTransaction(driver, pool, repos, exec) : await exec({ products: repo } as Repositories);
      res.json({ data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as unknown as { statusCode?: number }).statusCode;
      if (code === 404 || msg.includes('Product not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      next(err);
    }
  });

  return router;
}
