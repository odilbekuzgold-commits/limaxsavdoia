import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Repositories, SalesSettings, UpdateSalesSettings, UserRole } from '@limax/shared';
import { UpdateSalesSettingsSchema } from '@limax/shared';
import { checkPermission } from '../common/middleware/rbac.js';
import { logAudit } from '../common/middleware/audit.js';

export async function getSalesSettings(
  repos: Repositories,
  userRole: UserRole = 'VIEWER'
): Promise<SalesSettings> {
  checkPermission(userRole, 'settings.read');
  return repos.salesSettings.getSettings();
}

export async function updateSalesSettings(
  repos: Repositories,
  data: unknown,
  userId: string = 'system_user',
  userRole: UserRole = 'ADMIN'
): Promise<SalesSettings> {
  checkPermission(userRole, 'settings.update');

  const parsed = UpdateSalesSettingsSchema.parse(data) as UpdateSalesSettings;

  const updated = await repos.salesSettings.updateSettings(parsed);

  await logAudit(repos, { userId, userRole }, 'UPDATE_SALES_SETTINGS', 'sales_settings', updated.id, {
    data: parsed,
  });

  return updated;
}

export function createSettingsRouter(repos: Repositories): Router {
  const router = Router();

  router.get('/sales', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getSalesSettings(repos);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/sales', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateSalesSettings(repos, req.body);
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
