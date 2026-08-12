import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Repositories, ProductInventory, UpdateProductInventory, UserRole } from '@limax/shared';
import { UpdateProductInventorySchema } from '@limax/shared';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';

export async function getProductInventory(
  repos: Repositories,
  productId?: string,
  userRole: UserRole = 'VIEWER'
): Promise<ProductInventory | ProductInventory[] | null> {
  checkPermission(userRole, 'inventory.read');
  if (productId) {
    return repos.productInventory.findByProductId(productId);
  }
  return repos.productInventory.findAll();
}

export async function updateProductInventory(
  repos: Repositories,
  productId: string,
  data: unknown,
  userId: string = 'system_user',
  userRole: UserRole = 'ADMIN'
): Promise<ProductInventory> {
  checkPermission(userRole, 'inventory.update');

  const parsed = UpdateProductInventorySchema.parse(data) as UpdateProductInventory;

  const updated = await repos.productInventory.upsert(productId, { ...parsed, updatedBy: userId });

  await logAudit(repos, { userId, userRole }, 'UPDATE_PRODUCT_INVENTORY', 'product_inventory', updated.id, {
    productId,
    status: updated.status,
    availableQuantity: updated.availableQuantity,
    reservedQuantity: updated.reservedQuantity,
  });

  return updated;
}

export function createInventoryRouter(repos: Repositories): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = req.query.productId as string | undefined;
      const result = await getProductInventory(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:productId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProductInventory(repos, req.params.productId, req.body);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
