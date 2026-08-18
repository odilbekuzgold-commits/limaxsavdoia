import { TelegramApiError } from './errors.js';
import type {
  TelegramUser,
  TelegramUpdate,
  TelegramBusinessConnection,
  TelegramMessage,
  WebhookInfo,
} from './types.js';

export interface TelegramClientConfig {
  botToken: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class TelegramClient {
  private token: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: TelegramClientConfig) {
    if (!config.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required for TelegramClient');
    }
    this.token = config.botToken;
    this.baseUrl = config.baseUrl || 'https://api.telegram.org';
    this.timeoutMs = config.timeoutMs || 10000;
  }

  private async request<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/bot${this.token}/${method}`;
    const controller = new AbortController();
    const longPollTimeoutSec = typeof body?.timeout === 'number' ? (body.timeout as number) : 0;
    const effectiveTimeoutMs = longPollTimeoutSec > 0
      ? (longPollTimeoutSec + 15) * 1000
      : Math.max(this.timeoutMs, 30000);
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = (await response.json()) as {
        ok: boolean;
        result?: T;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
      };

      if (!response.ok || !data.ok) {
        const retryAfter = data.parameters?.retry_after;
        const sanitizedDesc = (data.description || 'Telegram API request failed').replace(
          new RegExp(this.token, 'g'),
          '[REDACTED_TOKEN]'
        );
        throw new TelegramApiError(sanitizedDesc, {
          statusCode: response.status,
          errorCode: data.error_code,
          retryAfter,
        });
      }

      return data.result as T;
    } catch (err: unknown) {
      if (err instanceof TelegramApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const sanitizedMsg = msg.replace(new RegExp(this.token, 'g'), '[REDACTED_TOKEN]');
      throw new TelegramApiError(`Telegram request failed: ${sanitizedMsg}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>('getMe');
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    return this.request<WebhookInfo>('getWebhookInfo');
  }

  async getUpdates(params?: {
    offset?: number;
    limit?: number;
    timeout?: number;
    allowed_updates?: string[];
  }): Promise<TelegramUpdate[]> {
    return this.request<TelegramUpdate[]>('getUpdates', params as Record<string, unknown>);
  }

  async getBusinessConnection(connectionId: string): Promise<TelegramBusinessConnection> {
    return this.request<TelegramBusinessConnection>('getBusinessConnection', {
      business_connection_id: connectionId,
    });
  }

  async sendMessage(params: {
    business_connection_id?: string;
    chat_id: number | string;
    text: string;
    reply_to_message_id?: number;
    parse_mode?: string;
  }): Promise<TelegramMessage> {
    return this.request<TelegramMessage>('sendMessage', params as Record<string, unknown>);
  }

  async sendChatAction(params: {
    business_connection_id?: string;
    chat_id: number | string;
    action: 'typing' | 'upload_photo' | 'record_video' | 'record_voice' | 'upload_document';
  }): Promise<boolean> {
    return this.request<boolean>('sendChatAction', params as Record<string, unknown>);
  }

  async setWebhook(params: {
    url: string;
    secret_token?: string;
    allowed_updates?: string[];
  }): Promise<boolean> {
    return this.request<boolean>('setWebhook', params as Record<string, unknown>);
  }

  async deleteWebhook(params?: { drop_pending_updates?: boolean }): Promise<boolean> {
    return this.request<boolean>('deleteWebhook', params as Record<string, unknown>);
  }
}
