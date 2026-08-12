import { Router, type Request, type Response } from 'express';
import type { Repositories } from '@limax/shared';
import type { TelegramClient } from '@limax/channel-adapters';
import { processTelegramUpdate } from './service.js';

export function createTelegramWebhookRouter(
  repos: Repositories,
  client?: TelegramClient,
  webhookSecret?: string,
  allowRegularMessages?: boolean,
  managerChatId?: string
): Router {
  const router: Router = Router();

  // POST /api/v1/webhooks/telegram
  router.post('/', async (req: Request, res: Response) => {
    // 1. Secret Token Verification
    if (webhookSecret) {
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
      if (!incomingSecret || incomingSecret !== webhookSecret) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED_WEBHOOK_SECRET', message: 'Invalid secret token' } });
        return;
      }
    }

    try {
      const result = await processTelegramUpdate({
        update: req.body,
        repos,
        client,
        allowRegularMessages,
        managerChatId,
      });

      res.status(200).json({ ok: true, result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(200).json({ ok: false, error: msg });
    }
  });

  return router;
}
