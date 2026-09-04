import { Router, type Request, type Response } from 'express';
import type { RepositoryDriver } from '@limax/database';
import type { Repositories } from '@limax/shared';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  REQUIRED_SPREADSHEET_ID,
} from '@limax/integrations';

export interface GoogleSheetsRouterOptions {
  repos: Repositories;
  driver: RepositoryDriver;
  pool?: any;
  spreadsheetId?: string;
  serviceAccountEmail?: string;
  privateKey?: string;
  internalToken?: string;
}

export function createGoogleSheetsRouter(options: GoogleSheetsRouterOptions): Router {
  const router = Router();
  const { repos, driver, pool, internalToken } = options;

  // Auth Middleware
  const authMiddleware = (req: Request, res: Response, next: () => void) => {
    const authHeader = req.headers['authorization'];
    const tokenHeader = req.headers['x-internal-token'];
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const provided = tokenHeader || bearer;

    const expectedToken = internalToken || process.env.INTERNAL_API_TOKEN || 'limax-internal-secret-token';
    if (!provided || provided !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing internal token' });
      return;
    }
    next();
  };

  // 1. GET /api/v1/integrations/google-sheets/status
  router.get('/status', authMiddleware, async (_req: Request, res: Response) => {
    try {
      const latest = await repos.googleSheetsSync.getLatest(REQUIRED_SPREADSHEET_ID);
      const latestSuccess = await repos.googleSheetsSync.getLatestSuccess(REQUIRED_SPREADSHEET_ID);

      const now = Date.now();
      const lastSuccessTime = latestSuccess?.lastSuccessAt ? new Date(latestSuccess.lastSuccessAt).getTime() : 0;
      const isStale = !lastSuccessTime || now - lastSuccessTime > 10 * 60 * 1000; // 10 minutes

      let knowledgeCount = 0;
      if (repos.knowledge) {
        try {
          const items = await repos.knowledge.findAll({});
          knowledgeCount = items.length;
        } catch {}
      }

      res.status(200).json({
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${REQUIRED_SPREADSHEET_ID}/edit`,
        lastAttemptAt: latest?.lastAttemptAt || null,
        lastSuccessAt: latestSuccess?.lastSuccessAt || null,
        status: latest?.status || 'NOT_SYNCED',
        isStale,
        counts: {
          products: latestSuccess?.productsCount || 0,
          prices: latestSuccess?.pricesCount || 0,
          inventory: latestSuccess?.inventoryCount || 0,
          knowledge: knowledgeCount,
        },
        checksum: latestSuccess?.checksum || null,
        error: latest?.sanitizedError || null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Failed to retrieve sync status', message: msg });
    }
  });

  // 2. POST /api/v1/integrations/google-sheets/sync
  router.post('/sync', authMiddleware, async (req: Request, res: Response) => {
    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;

    try {
      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || REQUIRED_SPREADSHEET_ID;
      const client = new GoogleSheetsClient({
        spreadsheetId,
        serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: process.env.GOOGLE_PRIVATE_KEY,
      });

      const engine = new GoogleSheetsSyncEngine(client, repos, driver, pool);
      const result = await engine.runSync({ dryRun });

      if (!result.success) {
        res.status(400).json(result);
        return;
      }

      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Concurrent Google Sheets sync in progress')) {
        res.status(409).json({ error: 'Sync already in progress', message: msg });
        return;
      }
      res.status(500).json({ error: 'Google Sheets sync failed', message: msg });
    }
  });

  return router;
}
