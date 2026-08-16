import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Repositories, ProductPrice, CreateProductPrice, UserRole } from '@limax/shared';
import { CreateProductPriceSchema } from '@limax/shared';
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
  userRole: UserRole = 'ADMIN'
): Promise<ProductPrice> {
  checkPermission(userRole, 'pricing.create');

  const raw = data as Record<string, unknown>;
  const amount = typeof raw.amount === 'number' ? raw.amount : typeof raw.price === 'number' ? raw.price : 0;
  if (amount <= 0) {
    throw new Error('Price amount must be strictly greater than 0');
  }

  const validFrom = raw.validFrom ? new Date(raw.validFrom as string) : new Date();
  const validUntil = raw.validUntil ? new Date(raw.validUntil as string) : undefined;

  if (validUntil && validFrom > validUntil) {
    throw new Error('validFrom date cannot be after validUntil date');
  }

  const productId = (raw.productId as string) || '';
  const isActive = raw.active !== false;

  // Deactivate previous active prices for the same product if creating new active price
  if (isActive && productId) {
    const existingPrices = await repos.productPrices.findByProductId(productId);
    for (const p of existingPrices) {
      if (p.active) {
        await repos.productPrices.update(p.id, { active: false });
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

  const created = await repos.productPrices.create({ ...parsed, updatedBy: userId });

  await logAudit(repos, { userId, userRole }, 'CREATE_PRODUCT_PRICE', 'product_prices', created.id, {
    productId: created.productId,
    price: created.price,
    currency: created.currency,
    active: created.active,
  });

  return created;
}

export async function updateProductPrice(
  repos: Repositories,
  priceId: string,
  data: Partial<ProductPrice>,
  userId: string = 'dashboard-admin',
  userRole: UserRole = 'ADMIN'
): Promise<ProductPrice | null> {
  checkPermission(userRole, 'pricing.update');

  const updated = await repos.productPrices.update(priceId, { ...data, updatedBy: userId });

  if (updated) {
    await logAudit(repos, { userId, userRole }, 'UPDATE_PRODUCT_PRICE', 'product_prices', priceId, { data });
  }

  return updated;
}

export function createPricingRouter(repos: Repositories): Router {
  const router = Router();

  // GET /api/v1/pricing
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = (req.query.productId as string) || '';
      const result = await getProductPrices(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/pricing
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProductPrice(repos, req.body);
      res.status(201).json({ data: created });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('greater than 0') || msg.includes('validFrom date cannot be after')) {
        res.status(400).json({ error: { code: 'INVALID_PRICING', message: msg } });
        return;
      }
      next(err);
    }
  });

  // PATCH /api/v1/pricing/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProductPrice(repos, req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Price record not found' } });
        return;
      }
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/pricing/:id/deactivate
  router.post('/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProductPrice(repos, req.params.id, { active: false });
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
