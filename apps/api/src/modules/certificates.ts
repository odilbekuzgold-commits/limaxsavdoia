import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Repositories, ProductCertificate, CreateProductCertificate, UserRole } from '@limax/shared';
import { CreateProductCertificateSchema } from '@limax/shared';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';

export async function getProductCertificates(
  repos: Repositories,
  productId: string,
  userRole: UserRole = 'VIEWER'
): Promise<ProductCertificate[]> {
  checkPermission(userRole, 'products.read');
  return repos.productCertificates.findByProductId(productId);
}

export async function createProductCertificate(
  repos: Repositories,
  data: unknown,
  userId: string = 'system_user',
  userRole: UserRole = 'ADMIN'
): Promise<ProductCertificate> {
  checkPermission(userRole, 'products.update');

  const parsed = CreateProductCertificateSchema.parse(data) as CreateProductCertificate;

  const created = await repos.productCertificates.create(parsed);

  await logAudit(repos, { userId, userRole }, 'CREATE_PRODUCT_CERTIFICATE', 'product_certificates', created.id, {
    productId: created.productId,
    name: created.name,
    certificateNumber: created.certificateNumber,
  });

  return created;
}

export function createCertificatesRouter(repos: Repositories): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = (req.query.productId as string) || '';
      if (!productId) {
        res.json({ data: [] });
        return;
      }
      const result = await getProductCertificates(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProductCertificate(repos, req.body);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
