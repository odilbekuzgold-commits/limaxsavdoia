import type { TelegramUpdate, TelegramMessage, NormalizedMessage } from './types.js';

export function extractMessageFromUpdate(update: TelegramUpdate): {
  msg: TelegramMessage | null;
  updateType: string;
  isBusiness: boolean;
} {
  if (update.business_message) {
    return { msg: update.business_message, updateType: 'business_message', isBusiness: true };
  }
  if (update.edited_business_message) {
    return { msg: update.edited_business_message, updateType: 'edited_business_message', isBusiness: true };
  }
  if (update.message) {
    return { msg: update.message, updateType: 'message', isBusiness: false };
  }
  if (update.edited_message) {
    return { msg: update.edited_message, updateType: 'edited_message', isBusiness: false };
  }
  if (update.business_connection) {
    return { msg: null, updateType: 'business_connection', isBusiness: true };
  }
  if (update.deleted_business_messages) {
    return { msg: null, updateType: 'deleted_business_messages', isBusiness: true };
  }
  return { msg: null, updateType: 'unknown', isBusiness: false };
}

export function normalizeTelegramMessage(
  update: TelegramUpdate
): NormalizedMessage | null {
  const { msg, updateType } = extractMessageFromUpdate(update);
  if (!msg) return null;

  const sender = msg.from;
  const senderId = sender ? String(sender.id) : String(msg.chat.id);
  const senderName = sender
    ? [sender.first_name, sender.last_name].filter(Boolean).join(' ')
    : msg.chat.first_name || msg.chat.title || 'Telegram User';

  let messageType: NormalizedMessage['messageType'] = 'text';
  let mediaFileId: string | undefined;

  if (msg.photo && msg.photo.length > 0) {
    messageType = 'image';
    mediaFileId = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.voice || msg.audio) {
    messageType = 'audio';
    mediaFileId = msg.voice?.file_id || msg.audio?.file_id;
  } else if (msg.document || msg.video) {
    messageType = 'document';
    mediaFileId = msg.document?.file_id || msg.video?.file_id;
  }

  const rawText = msg.text || msg.caption || '';
  const text = rawText.slice(0, 4096);

  // Whitelisted raw metadata (no tokens/secrets)
  const rawMetadata: Record<string, unknown> = {
    updateType,
    chatType: msg.chat.type,
    date: msg.date,
  };
  if (msg.photo) rawMetadata.photoCount = msg.photo.length;
  if (msg.document) rawMetadata.documentName = msg.document.file_name;
  if (msg.reply_to_message) rawMetadata.replyToId = String(msg.reply_to_message.message_id);

  return {
    channel: 'TELEGRAM',
    externalUpdateId: update.update_id,
    externalMessageId: String(msg.message_id),
    businessConnectionId: msg.business_connection_id,
    chatId: String(msg.chat.id),
    senderId,
    senderUsername: sender?.username,
    senderName,
    messageType,
    text,
    caption: msg.caption ? msg.caption.slice(0, 4096) : undefined,
    mediaFileId,
    replyToMessageId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
    sentAt: new Date(msg.date * 1000),
    rawMetadata,
  };
}
