import type { TelegramClient } from './client.js';
import type { TelegramMessage } from './types.js';

export interface SendTelegramOptions {
  businessConnectionId?: string;
  chatId: string | number;
  text: string;
  replyToMessageId?: string;
  sendTyping?: boolean;
}

export async function sendTelegramTextMessage(
  client: TelegramClient,
  options: SendTelegramOptions
): Promise<TelegramMessage> {
  const { businessConnectionId, chatId, text, replyToMessageId, sendTyping } = options;

  if (sendTyping) {
    try {
      await client.sendChatAction({
        business_connection_id: businessConnectionId,
        chat_id: chatId,
        action: 'typing',
      });
    } catch {
      // Non-critical action failure ignore
    }
  }

  return client.sendMessage({
    business_connection_id: businessConnectionId,
    chat_id: chatId,
    text,
    reply_to_message_id: replyToMessageId ? parseInt(replyToMessageId, 10) : undefined,
  });
}
