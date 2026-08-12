import type { NormalizedChannelMessage } from '../types.js';
import type { WhatsAppWebhookPayload, WhatsAppMessage } from './types.js';

export function normalizeWhatsAppMessage(payload: WhatsAppWebhookPayload): NormalizedChannelMessage | null {
  if (!payload.entry || payload.entry.length === 0) return null;

  const entry = payload.entry[0];
  if (!entry.changes || entry.changes.length === 0) return null;

  const change = entry.changes[0];
  const value = change.value;

  if (!value.messages || value.messages.length === 0) return null;

  const msg: WhatsAppMessage = value.messages[0];
  const contact = value.contacts?.[0];

  let textContent = '';
  let msgType: NormalizedChannelMessage['messageType'] = 'text';

  if (msg.type === 'text' && msg.text) {
    textContent = msg.text.body;
  } else if (msg.type === 'image' && msg.image) {
    textContent = msg.image.caption || '[Photo]';
    msgType = 'photo';
  } else if (msg.type === 'document' && msg.document) {
    textContent = msg.document.caption || msg.document.filename || '[Document]';
    msgType = 'document';
  } else if (msg.type === 'location' && msg.location) {
    textContent = `[Location: ${msg.location.latitude}, ${msg.location.longitude}]`;
    msgType = 'location';
  } else {
    textContent = `[${msg.type} message]`;
    msgType = 'other';
  }

  const senderName = contact?.profile?.name || msg.from;

  return {
    channel: 'whatsapp',
    messageId: msg.id,
    senderId: msg.from,
    senderName,
    chatId: msg.from,
    text: textContent,
    messageType: msgType,
    sentAt: new Date(parseInt(msg.timestamp, 10) * 1000 || Date.now()),
    rawMetadata: {
      whatsappMessageId: msg.id,
      phoneNumberId: value.metadata.phone_number_id,
      displayPhoneNumber: value.metadata.display_phone_number,
    },
  };
}
