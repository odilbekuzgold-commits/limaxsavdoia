import type { Repositories } from '@limax/shared';
import {
  normalizeWhatsAppMessage,
  type WhatsAppClient,
  type WhatsAppWebhookPayload,
} from '@limax/channel-adapters';
import { AIOrchestrator, detectLanguage } from '@limax/ai-engine';

const orchestrator = new AIOrchestrator();

export interface ProcessWhatsAppUpdateOptions {
  payload: unknown;
  repos: Repositories;
  client?: WhatsAppClient;
}

export interface ProcessWhatsAppUpdateResult {
  status: 'PROCESSED' | 'SKIPPED' | 'IGNORED';
  messageId?: string;
  reason?: string;
}

export function verifyWhatsAppWebhook(query: {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}, verifyToken: string): { status: boolean; challenge?: string } {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    return { status: true, challenge };
  }
  return { status: false };
}

export async function processWhatsAppUpdate(
  options: ProcessWhatsAppUpdateOptions
): Promise<ProcessWhatsAppUpdateResult> {
  const { payload, repos, client } = options;

  const normalized = normalizeWhatsAppMessage(payload as WhatsAppWebhookPayload);
  if (!normalized) {
    return { status: 'IGNORED', reason: 'UNSUPPORTED_WHATSAPP_PAYLOAD' };
  }

  // Idempotency / Receipt Check
  const existingReceipt = await repos.telegramReceipts.findByUpdateId(normalized.messageId as unknown as number);
  if (existingReceipt) {
    return { status: 'SKIPPED', messageId: normalized.messageId, reason: 'DUPLICATE_WHATSAPP_MESSAGE_ID' };
  }

  // Find or Create Customer & Contact for WhatsApp
  const customerName = normalized.senderName || `WhatsApp ${normalized.senderId}`;
  const detectedLang = detectLanguage(normalized.text);

  let contact = await repos.contacts.findByChannelAndExternalId('whatsapp', normalized.senderId);
  let customerId: string;

  if (!contact) {
    const newCustomer = await repos.customers.create({
      name: customerName,
      preferredLanguage: detectedLang,
      status: 'active',
      tags: ['whatsapp'],
    });
    customerId = newCustomer.id;

    contact = await repos.contacts.create({
      customerId: newCustomer.id,
      channel: 'whatsapp',
      externalId: normalized.senderId,
      username: normalized.senderName,
      isPrimary: true,
    });
  } else {
    customerId = contact.customerId;
  }

  // Find or Create Active Conversation
  const allConvs = await repos.conversations.findAll({});
  let conv = allConvs.find((c: { customerId: string; status: string }) => c.customerId === customerId && c.status !== 'CLOSED');

  if (!conv) {
    conv = await repos.conversations.create({
      customerId,
      contactId: contact.id,
      status: 'AI_ACTIVE',
      channel: 'whatsapp',
      lastMessageAt: normalized.sentAt,
    });
  }

  // Save Incoming Customer Message
  await repos.messages.create({
    conversationId: conv.id,
    senderType: 'customer',
    senderId: normalized.senderId,
    content: normalized.text,
    contentType: normalized.messageType === 'photo' ? 'image' : normalized.messageType === 'location' ? 'text' : normalized.messageType === 'other' ? 'text' : normalized.messageType,
    status: 'RECEIVED',
    metadata: normalized.rawMetadata,
  });

  // State check
  if (conv.status !== 'AI_ACTIVE') {
    return { status: 'PROCESSED', messageId: normalized.messageId, reason: `AI_INACTIVE_${conv.status}` };
  }

  // AI Orchestration
  const convMessages = await repos.messages.findByConversationId(conv.id);
  const isNewConversation = convMessages.filter((m: { senderType: string }) => m.senderType === 'customer').length <= 1;
  const aiContext = {
    conversationId: conv.id,
    customerId,
    customerName,
    preferredLanguage: detectedLang,
    isNewConversation,
    conversationHistory: convMessages.map((m: { senderType: string; content: string }) => ({
      role: m.senderType === 'customer' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    })),
  };

  const orchestratorResult = await orchestrator.processQuery(normalized.text, aiContext, { repos });

  if (orchestratorResult.suppressAutoReply) {
    await repos.conversations.update(conv.id, { lastMessageAt: new Date() });
    return { status: 'PROCESSED', messageId: normalized.messageId, reason: 'SUPPRESSED_FOR_HANDOFF' };
  }

  const replyText = orchestratorResult.replyText;

  // Send WhatsApp reply via client if provided
  if (client) {
    try {
      await client.sendTextMessage({
        toPhoneNumber: normalized.senderId,
        text: replyText,
      });

      await repos.messages.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: replyText,
        contentType: 'text',
        status: 'SENT',
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await repos.messages.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: replyText,
        contentType: 'text',
        status: 'FAILED',
        metadata: { error: errMsg },
      });
    }
  } else {
    // Save outbound AI message record for test/dev mode
    await repos.messages.create({
      conversationId: conv.id,
      senderType: 'ai',
      content: replyText,
      contentType: 'text',
      status: 'SENT',
    });
  }

  await repos.conversations.update(conv.id, { lastMessageAt: new Date() });

  return { status: 'PROCESSED', messageId: normalized.messageId };
}
