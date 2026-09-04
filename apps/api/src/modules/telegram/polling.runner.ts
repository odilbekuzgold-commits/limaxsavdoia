import type { Repositories } from '@limax/shared';
import type { TelegramClient } from '@limax/channel-adapters';
import { logger } from '@limax/logger';
import { processTelegramUpdate } from './service.js';

export interface PollingRunnerConfig {
  client: TelegramClient;
  repos: Repositories;
  pollTimeoutSeconds?: number;
  pollLimit?: number;
  allowRegularMessages?: boolean;
  managerChatId?: string;
}

export class TelegramPollingRunner {
  private client: TelegramClient;
  private repos: Repositories;
  private pollTimeoutSeconds: number;
  private pollLimit: number;
  private allowRegularMessages: boolean;
  private managerChatId?: string;
  private isRunning = false;
  private offset = 0;

  constructor(config: PollingRunnerConfig) {
    this.client = config.client;
    this.repos = config.repos;
    this.pollTimeoutSeconds = config.pollTimeoutSeconds || 30;
    this.pollLimit = config.pollLimit || 50;
    this.allowRegularMessages = config.allowRegularMessages ?? true;
    this.managerChatId = config.managerChatId;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    let startupAttempt = 0;
    while (!this.isRunning) {
      try {
      // 1. Check getMe
      const me = await this.client.getMe();
      logger.info(`[Telegram Polling] Authenticated as bot @${me.username || me.first_name} (ID: ${me.id})`);

      // 2. Check getWebhookInfo
      const webhookInfo = await this.client.getWebhookInfo();
      if (webhookInfo.url) {
        logger.warn(
          `[Telegram Polling] Webhook is active at '${webhookInfo.url}'. Polling runner will NOT start to avoid conflicting update streams.`
        );
        return;
      }

      this.isRunning = true;
      logger.info('[Telegram Polling] Long polling loop started.');

      // Async loop execution
      this.pollLoop().catch((err) => {
        logger.error({ err }, '[Telegram Polling] Fatal error in polling loop');
      });
      return;
      } catch (err: unknown) {
        startupAttempt++;
        const msg = err instanceof Error ? err.message : String(err);
        const retryInMs = Math.min(1000 * Math.pow(2, startupAttempt), 30000);
        logger.warn(
          { startupAttempt, retryInMs },
          `[Telegram Polling] Failed to initialize polling runner: ${msg}. Retrying...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryInMs));
      }
    }
  }

  private async pollLoop(): Promise<void> {
    let consecutiveErrors = 0;

    while (this.isRunning) {
      try {
        const updates = await this.client.getUpdates({
          offset: this.offset,
          limit: this.pollLimit,
          timeout: this.pollTimeoutSeconds,
          allowed_updates: [
            'business_connection',
            'business_message',
            'edited_business_message',
            'deleted_business_messages',
            'message',
          ],
        });

        consecutiveErrors = 0;

        for (const update of updates) {
          try {
            logger.info({ updateId: update.update_id }, '[Telegram Polling] Processing incoming update');
            const res = await processTelegramUpdate({
              update,
              repos: this.repos,
              client: this.client,
              allowRegularMessages: this.allowRegularMessages,
              managerChatId: this.managerChatId,
            });
            logger.info({ updateId: update.update_id, result: res }, '[Telegram Polling] Update processed result');
          } catch (err) {
            logger.error({ err, updateId: update.update_id }, '[Telegram Polling] Error processing update');
          }

          // Advance offset
          this.offset = Math.max(this.offset, update.update_id + 1);
        }
      } catch (err: unknown) {
        if (!this.isRunning) break;
        consecutiveErrors++;
        const backoffMs = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
        logger.warn(
          { err, consecutiveErrors, retryInMs: backoffMs },
          '[Telegram Polling] Network error in polling request. Backing off...'
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  stop(): void {
    if (this.isRunning) {
      this.isRunning = false;
      logger.info('[Telegram Polling] Polling runner stopped.');
    }
  }
}
