import type { Repositories } from '@limax/shared';
import { AIOrchestrator, detectLanguage } from '@limax/ai-engine';

const orchestrator = new AIOrchestrator();

export interface ProcessWebChatMessageOptions {
  sessionId: string;
  senderName?: string;
  text: string;
  repos: Repositories;
}

export interface ProcessWebChatMessageResult {
  status: 'PROCESSED' | 'HANDOFF';
  replyText: string;
  conversationId: string;
}

export async function processWebChatMessage(
  options: ProcessWebChatMessageOptions
): Promise<ProcessWebChatMessageResult> {
  const { sessionId, senderName = 'Web Visitor', text, repos } = options;

  const detectedLang = detectLanguage(text);

  let contact = await repos.contacts.findByChannelAndExternalId('web', sessionId);
  let customerId: string;

  if (!contact) {
    const newCustomer = await repos.customers.create({
      name: senderName,
      preferredLanguage: detectedLang,
      status: 'active',
      tags: ['webchat'],
    });
    customerId = newCustomer.id;

    contact = await repos.contacts.create({
      customerId: newCustomer.id,
      channel: 'web',
      externalId: sessionId,
      username: senderName,
      isPrimary: true,
    });
  } else {
    customerId = contact.customerId;
  }

  const allConvs = await repos.conversations.findAll({});
  let conv = allConvs.find((c: { customerId: string; status: string }) => c.customerId === customerId && c.status !== 'CLOSED');

  if (!conv) {
    conv = await repos.conversations.create({
      customerId,
      contactId: contact.id,
      status: 'AI_ACTIVE',
      channel: 'web',
      lastMessageAt: new Date(),
    });
  }

  await repos.messages.create({
    conversationId: conv.id,
    senderType: 'customer',
    senderId: sessionId,
    content: text,
    contentType: 'text',
    status: 'RECEIVED',
  });

  const convMessages = await repos.messages.findByConversationId(conv.id);
  const aiContext = {
    customerId,
    customerName: senderName,
    preferredLanguage: detectedLang,
    conversationHistory: convMessages.map((m: { senderType: string; content: string }) => ({
      role: m.senderType === 'customer' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    })),
  };

  const orchestratorResult = await orchestrator.processQuery(text, aiContext, { repos });

  if (orchestratorResult.needsHandoff) {
    await repos.conversations.update(conv.id, { status: 'WAITING_MANAGER' });
    await repos.handoffs.create({
      conversationId: conv.id,
      customerId,
      reason: orchestratorResult.handoffReason || 'WEBCHAT_AI_HANDOFF',
      priority: 'high',
    });
  }

  await repos.messages.create({
    conversationId: conv.id,
    senderType: 'ai',
    content: orchestratorResult.replyText,
    contentType: 'text',
    status: 'SENT',
  });

  await repos.conversations.update(conv.id, { lastMessageAt: new Date() });

  return {
    status: orchestratorResult.needsHandoff ? 'HANDOFF' : 'PROCESSED',
    replyText: orchestratorResult.replyText,
    conversationId: conv.id,
  };
}
