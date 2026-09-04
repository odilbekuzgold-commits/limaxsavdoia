import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Repositories, ProductPrice, CreateProductPrice, UserRole } from '@limax/shared';
import { CreateProductPriceSchema } from '@limax/shared';
import { withTransaction, type RepositoryDriver } from '@limax/database';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';

export async function getProductPrices(
  repos: Repositories,
  productId: string,
  userRole: UserRole = 'VIEWER'
): Promise<ProductPrice[]> {
  checkPermission(userRole, 'pricing.read');
  return repos.productPrices.findByProductId(productId);
}

export async function createProductPrice(
  repos: Repositories,
  data: unknown,
  userId: string = 'dashboard-admin',
  userRole: UserRole = 'ADMIN',
  driver: RepositoryDriver = 'memory',
  pool?: any
): Promise<ProductPrice> {
  checkPermission(userRole, 'pricing.create');

  return withTransaction(driver, pool, repos, async (txRepos, txClient) => {
    const raw = (data || {}) as Record<string, unknown>;
    const productId = (raw.productId as string) || '';

    if (!productId) {
      throw new Error('productId is required for creating a price');
    }

    const product = await txRepos.products.findById(productId);
    if (!product) {
      const err = new Error('Product not found');
      (err as unknown as { statusCode: number }).statusCode = 404;
      throw err;
    }

    // Take advisory transaction lock on product to prevent concurrent active price creation
    if (txClient) {
      await txClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [productId]);
    }

    const amount = typeof raw.amount === 'number' ? raw.amount : typeof raw.price === 'number' ? raw.price : 0;
    if (amount <= 0) {
      throw new Error('Price amount must be strictly greater than 0');
    }

    const validFrom = raw.validFrom ? new Date(raw.validFrom as string) : new Date();
    const validUntil = raw.validUntil ? new Date(raw.validUntil as string) : undefined;

    if (validUntil && validFrom > validUntil) {
      throw new Error('validFrom date cannot be after validUntil date');
    }

    const isActive = raw.active !== false;

    // Deactivate previous active prices for the same product in this transaction
    if (isActive && productId) {
      const existingPrices = await txRepos.productPrices.findByProductId(productId);
      for (const p of existingPrices) {
        if (p.active) {
          await txRepos.productPrices.update(p.id, { active: false });
        }
      }
    }

    const parsed = CreateProductPriceSchema.parse({
      ...raw,
      price: amount,
      productId,
      validFrom,
      validUntil,
      active: isActive,
    }) as CreateProductPrice;

    const created = await txRepos.productPrices.create({ ...parsed, updatedBy: userId });

    await logAudit(txRepos, { userId, userRole }, 'CREATE_PRODUCT_PRICE', 'product_prices', created.id, {
      productId: created.productId,
      price: created.price,
      currency: created.currency,
      active: created.active,
    });

    return created;
  });
}

export async function updateProductPrice(
  repos: Repositories,
  priceId: string,
  data: Partial<ProductPrice>,
  userId: string = 'dashboard-admin',
  userRole: UserRole = 'ADMIN',
  driver: RepositoryDriver = 'memory',
  pool?: any
): Promise<ProductPrice | null> {
  checkPermission(userRole, 'pricing.update');

  return withTransaction(driver, pool, repos, async (txRepos) => {
    const updated = await txRepos.productPrices.update(priceId, { ...data, updatedBy: userId });
    if (updated) {
      await logAudit(txRepos, { userId, userRole }, 'UPDATE_PRODUCT_PRICE', 'product_prices', priceId, { data });
    }
    return updated;
  });
}

export function createPricingRouter(
  repos: Repositories,
  driver: RepositoryDriver = 'memory',
  pool?: any
): Router {
  const router = Router();

  // GET /api/v1/pricing
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = (req.query.productId as string) || '';
      if (!productId) {
        res.json({ data: [] });
        return;
      }
      const result = await getProductPrices(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/pricing (Atomic Transaction)
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProductPrice(repos, req.body, 'dashboard-admin', 'ADMIN', driver, pool);
      res.status(201).json({ data: created });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as unknown as { statusCode?: number; code?: string }).statusCode;
      const pgCode = (err as unknown as { code?: string }).code;
      if (pgCode === '23505' || msg.includes('23505') || msg.includes('uq_product_prices_single_active')) {
        res.status(409).json({ error: { code: 'DUPLICATE_ACTIVE_PRICE', message: 'An active price already exists for this product' } });
        return;
      }
      if (code === 404 || msg.includes('Product not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      if (msg.includes('greater than 0') || msg.includes('validFrom date cannot be after') || msg.includes('productId is required')) {
        res.status(400).json({ error: { code: 'INVALID_PRICING', message: msg } });
        return;
      }
      next(err);
    }
  });

  // PATCH /api/v1/pricing/:id (Atomic Transaction)
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProductPrice(repos, req.params.id, req.body, 'dashboard-admin', 'ADMIN', driver, pool);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Price record not found' } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/pricing/:id/deactivate (Atomic Transaction)
  router.post('/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProductPrice(repos, req.params.id, { active: false }, 'dashboard-admin', 'ADMIN', driver, pool);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Price record not found' } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
