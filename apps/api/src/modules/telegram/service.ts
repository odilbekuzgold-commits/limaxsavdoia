import type { Repositories } from '@limax/shared';
import {
  type TelegramClient,
  TelegramUpdateSchema,
  normalizeTelegramMessage,
  sendTelegramTextMessage,
  type TelegramUpdate,
} from '@limax/channel-adapters';
import {
  AIOrchestrator,
  detectLanguage,
} from '@limax/ai-engine';

const orchestrator = new AIOrchestrator();

export interface ProcessTelegramUpdateOptions {
  update: unknown;
  repos: Repositories;
  client?: TelegramClient;
  allowRegularMessages?: boolean;
  managerChatId?: string;
}

export interface ProcessTelegramUpdateResult {
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED' | 'IGNORED';
  updateId?: number;
  updateType?: string;
  reason?: string;
}

export async function processTelegramUpdate(
  options: ProcessTelegramUpdateOptions
): Promise<ProcessTelegramUpdateResult> {
  const { update: rawUpdate, repos, client, allowRegularMessages = true, managerChatId } = options;

  // 1. Zod Schema Validation
  const parseResult = TelegramUpdateSchema.safeParse(rawUpdate);
  if (!parseResult.success) {
    return { status: 'SKIPPED', reason: 'INVALID_TELEGRAM_UPDATE_SCHEMA' };
  }
  const update = parseResult.data as TelegramUpdate;
  const updateId = update.update_id;

  // 2. Update Idempotency Check
  const existingReceipt = await repos.telegramReceipts.findByUpdateId(updateId);
  if (existingReceipt) {
    return { status: 'SKIPPED', updateId, reason: 'DUPLICATE_UPDATE_ID' };
  }

  // 3. Handle Business Connection Updates
  if (update.business_connection) {
    const conn = update.business_connection;
    await repos.telegramConnections.upsert({
      connectionId: conn.id,
      businessUserId: String(conn.user.id),
      userChatId: String(conn.user_chat_id),
      isEnabled: conn.is_enabled,
      rights: { can_reply: conn.can_reply },
      connectedAt: new Date(conn.date * 1000),
    });
    await repos.telegramReceipts.create({
      updateId,
      updateType: 'business_connection',
      status: 'PROCESSED',
    });
    return { status: 'PROCESSED', updateId, updateType: 'business_connection' };
  }

  // 4. Normalize Message
  const normalized = normalizeTelegramMessage(update);
  if (!normalized) {
    await repos.telegramReceipts.create({
      updateId,
      updateType: 'ignored_update',
      status: 'SKIPPED',
    });
    return { status: 'IGNORED', updateId, reason: 'UNSUPPORTED_UPDATE_TYPE' };
  }

  // 5. Filters: Ignore own bot messages & non-private chat messages
  if (update.message?.from?.is_bot || update.business_message?.from?.is_bot) {
    await repos.telegramReceipts.create({ updateId, updateType: 'bot_self_message', status: 'SKIPPED' });
    return { status: 'IGNORED', updateId, reason: 'IGNORE_BOT_SELF_MESSAGE' };
  }

  // Ignore messages sent by the business account owner (outgoing messages sent via business connection)
  if (update.business_message?.from && update.business_message.business_connection_id) {
    const senderUserId = String(update.business_message.from.id);
    const existingConn = await repos.telegramConnections.findByConnectionId(update.business_message.business_connection_id);
    if (existingConn && existingConn.businessUserId === senderUserId) {
      await repos.telegramReceipts.create({ updateId, updateType: 'business_owner_self_message', status: 'SKIPPED' });
      return { status: 'IGNORED', updateId, reason: 'IGNORE_BUSINESS_OWNER_SELF_MESSAGE' };
    }
  }

  // Ignore group / channel messages
  const chatType = update.message?.chat?.type || update.business_message?.chat?.type;
  if (chatType && chatType !== 'private') {
    await repos.telegramReceipts.create({ updateId, updateType: 'group_channel_message', status: 'SKIPPED' });
    return { status: 'IGNORED', updateId, reason: 'IGNORE_NON_PRIVATE_CHAT' };
  }

  // Ignore regular messages if dev regular messages not allowed
  const isBusinessMessage = Boolean(normalized.businessConnectionId);
  if (!isBusinessMessage && !allowRegularMessages) {
    await repos.telegramReceipts.create({ updateId, updateType: 'regular_message_disabled', status: 'SKIPPED' });
    return { status: 'IGNORED', updateId, reason: 'REGULAR_MESSAGES_DISABLED' };
  }

  // 6. Find or Create Customer & Contact
  const customerName = normalized.senderName || 'Telegram User';
  const detectedLang = detectLanguage(normalized.text);

  let contact = await repos.contacts.findByChannelAndExternalId('telegram', normalized.senderId);
  let customerId: string;

  if (!contact) {
    const newCustomer = await repos.customers.create({
      name: customerName,
      preferredLanguage: detectedLang,
      status: 'active',
      tags: ['telegram'],
    });
    customerId = newCustomer.id;

    contact = await repos.contacts.create({
      customerId: newCustomer.id,
      channel: 'telegram',
      externalId: normalized.senderId,
      username: normalized.senderUsername,
      isPrimary: true,
    });
  } else {
    customerId = contact.customerId;
  }

  // 7. Find or Create Active Conversation
  const allConvs = await repos.conversations.findAll({});
  let conv = allConvs.find((c) => c.customerId === customerId && c.status !== 'CLOSED');

  if (!conv) {
    conv = await repos.conversations.create({
      customerId,
      contactId: contact.id,
      status: 'AI_ACTIVE',
      channel: 'telegram',
      lastMessageAt: normalized.sentAt,
    });
  }

  // 8. Save Incoming Message
  await repos.messages.create({
    conversationId: conv.id,
    senderType: 'customer',
    senderId: normalized.senderId,
    content: normalized.text || '[Media Content]',
    contentType: normalized.messageType === 'other' ? 'text' : normalized.messageType,
    status: 'RECEIVED',
    metadata: normalized.rawMetadata,
  });

  // 9. State Check: If conversation is not AI_ACTIVE, AI does not reply automatically
  if (conv.status !== 'AI_ACTIVE') {
    await repos.telegramReceipts.create({ updateId, updateType: 'message_saved_ai_inactive', status: 'PROCESSED' });
    return { status: 'PROCESSED', updateId, reason: `AI_INACTIVE_FOR_STATUS_${conv.status}` };
  }

  // 10. AI Response & Guardrail Processing via AIOrchestrator
  const convMessages = await repos.messages.findByConversationId(conv.id);
  // isNewConversation = true only if this is the very first incoming message
  // (convMessages contains only the one we just saved above, so length === 1)
  const isNewConversation = convMessages.filter((m) => m.senderType === 'customer').length <= 1;
  const aiContext = {
    conversationId: conv.id,
    customerId,
    customerName,
    preferredLanguage: detectedLang,
    isNewConversation,
    conversationHistory: convMessages.map((m) => ({
      role: m.senderType === 'customer' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    })),
  };


  const orchestratorResult = await orchestrator.processQuery(normalized.text, aiContext, { repos });

  // 11. Handoff Auto-Reply Suppression Check
  if (orchestratorResult.suppressAutoReply) {
    if (client && managerChatId) {
      try {
        await sendTelegramTextMessage(client, {
          chatId: managerChatId,
          text: `🚨 MANAGER HANDOFF REQUIRED\n\nCustomer: ${customerName}\nLanguage: ${detectedLang}\nReason: ${orchestratorResult.handoffReason || 'AI Handoff Triggered'}`,
        });
      } catch {
        // Non-critical manager notification failure
      }
    }
    await repos.conversations.update(conv.id, { lastMessageAt: new Date() });
    await repos.telegramReceipts.create({ updateId, updateType: 'handoff_suppressed', status: 'PROCESSED' });
    return {
      status: 'PROCESSED',
      updateId,
      updateType: 'message',
      reason: 'SUPPRESSED_FOR_HANDOFF',
    };
  }

  // 11. Send Outgoing Reply via Telegram Client (if client available)
  const replyText = orchestratorResult.replyText;

  // Duplicate Reply Prevention: If the bot already sent the exact same reply in the last 2 minutes, suppress duplicate reply
  const lastAiMsg = [...convMessages].reverse().find((m) => m.senderType === 'ai');
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  if (lastAiMsg && lastAiMsg.content === replyText && new Date(lastAiMsg.createdAt) > twoMinutesAgo) {
    await repos.telegramReceipts.create({ updateId, updateType: 'duplicate_reply_suppressed', status: 'SKIPPED' });
    return { status: 'PROCESSED', updateId, reason: 'DUPLICATE_REPLY_SUPPRESSED' };
  }

  if (client) {
    try {
      // Natural human response delay (simulates real manager typing time)
      if (process.env.RESPONSE_DELAY_ENABLED !== 'false' && process.env.NODE_ENV !== 'test') {
        const minMs = parseInt(process.env.RESPONSE_DELAY_MIN_MS || '2000', 10);
        const maxMs = parseInt(process.env.RESPONSE_DELAY_MAX_MS || '6000', 10);
        const perCharMs = parseInt(process.env.RESPONSE_DELAY_PER_CHAR_MS || '25', 10);

        const charDelay = replyText.length * perCharMs;
        const randomJitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        const totalDelayMs = Math.min(15000, charDelay + randomJitter);

        await new Promise((resolve) => setTimeout(resolve, totalDelayMs));
      }

      const sentTelegramMsg = await sendTelegramTextMessage(client, {
        businessConnectionId: normalized.businessConnectionId,
        chatId: normalized.chatId,
        text: replyText,
        sendTyping: true,
      });

      await repos.messages.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: replyText,
        contentType: 'text',
        status: 'SENT',
        metadata: { telegramMessageId: String(sentTelegramMsg.message_id) },
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
    // Development / Test mode without client
    await repos.messages.create({
      conversationId: conv.id,
      senderType: 'ai',
      content: replyText,
      contentType: 'text',
      status: 'SENT',
    });
  }

  await repos.conversations.update(conv.id, { lastMessageAt: new Date() });
  await repos.telegramReceipts.create({ updateId, updateType: 'message_processed', status: 'PROCESSED' });

  return {
    status: 'PROCESSED',
    updateId,
    updateType: 'message',
  };
}
