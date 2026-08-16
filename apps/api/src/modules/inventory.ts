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
  userId: string = 'dashboard-admin',
  userRole: UserRole = 'ADMIN'
): Promise<ProductInventory> {
  checkPermission(userRole, 'inventory.update');

  const raw = (data || {}) as Record<string, unknown>;
  const availableQuantity = typeof raw.availableQuantity === 'number' ? raw.availableQuantity : 0;
  const reservedQuantity = typeof raw.reservedQuantity === 'number' ? raw.reservedQuantity : 0;

  if (availableQuantity < 0 || reservedQuantity < 0) {
    throw new Error('Inventory quantities cannot be negative');
  }

  if (reservedQuantity > availableQuantity) {
    throw new Error('reservedQuantity cannot be greater than availableQuantity');
  }

  // Check product existence
  const product = await repos.products.findById(productId);
  if (!product) {
    const err = new Error('Product not found');
    (err as unknown as { statusCode: number }).statusCode = 404;
    throw err;
  }

  const status = availableQuantity === 0 ? 'OUT_OF_STOCK' : ((raw.status as ProductInventory['status']) || 'IN_STOCK');

  const parsed = UpdateProductInventorySchema.parse({
    ...raw,
    availableQuantity,
    reservedQuantity,
    status,
  }) as UpdateProductInventory;

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

  // GET /api/v1/inventory
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = req.query.productId as string | undefined;
      const result = await getProductInventory(repos, productId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/v1/inventory/:productId
  router.put('/:productId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProductInventory(repos, req.params.productId, req.body);
      res.json({ data: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as unknown as { statusCode?: number }).statusCode;
      if (code === 404 || msg.includes('Product not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
        return;
      }
      if (msg.includes('reservedQuantity') || msg.includes('negative')) {
        res.status(400).json({ error: { code: 'INVALID_QUANTITY', message: msg } });
        return;
      }
      next(err);
    }
  });

  return router;
}
