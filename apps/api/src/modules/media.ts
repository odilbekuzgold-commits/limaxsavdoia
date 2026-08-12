import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Repositories, ProductMedia, CreateProductMedia, UserRole } from '@limax/shared';
import { CreateProductMediaSchema } from '@limax/shared';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';

export async function getProductMedia(
  repos: Repositories,
  productId: string,
  userRole: UserRole = 'VIEWER'
): Promise<ProductMedia[]> {
  checkPermission(userRole, 'products.read');
  return repos.productMedia.findByProductId(productId);
}

export async function createProductMedia(
  repos: Repositories,
  data: unknown,
  userId: string = 'system_user',
  userRole: UserRole = 'ADMIN'
): Promise<ProductMedia> {
  checkPermission(userRole, 'products.update');

  const parsed = CreateProductMediaSchema.parse(data) as CreateProductMedia;

  const created = await repos.productMedia.create(parsed);

  await logAudit(repos, { userId, userRole }, 'CREATE_PRODUCT_MEDIA', 'product_media', created.id, {
    productId: created.productId,
    type: created.type,
    title: created.title,
    storageKey: created.storageKey,
  });

  return created;
}

export function createMediaRouter(repos: Repositories): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = (req.query.productId as string) || '';
      const result = await getProductMedia(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProductMedia(repos, req.body);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
