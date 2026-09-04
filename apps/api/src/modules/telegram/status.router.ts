import { Router, type Request, type Response } from 'express';
import type { Repositories } from '@limax/shared';
import type { TelegramClient } from '@limax/channel-adapters';

export function createTelegramStatusRouter(
  repos: Repositories,
  client?: TelegramClient,
  botToken?: string,
  botUsername?: string,
  updateMode?: string,
  webhookUrl?: string,
  driverName?: string
): Router {
  const router: Router = Router();

  // GET /api/v1/integrations/telegram and /api/v1/integrations/telegram/status
  const handleStatus = async (_req: Request, res: Response) => {
    let canConnectToBusiness = false;
    let verifiedBotUsername = botUsername || null;

    if (client) {
      try {
        const me = await client.getMe();
        canConnectToBusiness = Boolean(me.can_connect_to_business);
        verifiedBotUsername = me.username || verifiedBotUsername;
      } catch {
        // Safe fallback if token is invalid or API unreachable
      }
    }

    const totalConn = await repos.telegramConnections.countTotal();
    const activeConn = await repos.telegramConnections.countActive();
    const lastUpdateAt = await repos.telegramReceipts.getLastUpdateAt();
    const lastErrorCode = await repos.telegramReceipts.getLastErrorCode();

    res.json({
      configured: Boolean(botToken && botToken !== 'CHANGE_ME'),
      botUsername: verifiedBotUsername,
      updateMode: updateMode || 'polling',
      webhookConfigured: Boolean(webhookUrl && webhookUrl.length > 0),
      canConnectToBusiness,
      businessConnectionCount: totalConn,
      enabledConnectionCount: activeConn,
      repositoryDriver: driverName || 'memory',
      lastUpdateAt: lastUpdateAt ? lastUpdateAt.toISOString() : null,
      lastErrorCode,
    });
  };

  router.get('/', handleStatus);
  router.get('/status', handleStatus);

  return router;
}
