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
  userId: string = 'system_user',
  userRole: UserRole = 'ADMIN'
): Promise<ProductPrice> {
  checkPermission(userRole, 'pricing.create');

  const parsed = CreateProductPriceSchema.parse(data) as CreateProductPrice;

  const created = await repos.productPrices.create({ ...parsed, updatedBy: userId });

  await logAudit(repos, { userId, userRole }, 'CREATE_PRODUCT_PRICE', 'product_prices', created.id, {
    productId: created.productId,
    price: created.price,
    currency: created.currency,
  });

  return created;
}

export async function updateProductPrice(
  repos: Repositories,
  priceId: string,
  data: Partial<ProductPrice>,
  userId: string = 'system_user',
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

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = (req.query.productId as string) || '';
      const result = await getProductPrices(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProductPrice(repos, req.body);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
