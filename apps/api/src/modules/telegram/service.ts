import type { Repositories, Conversation } from '@limax/shared';
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
  getLocalizedTemplate,
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

async function deliverHandoffNotifications(options: {
  conv: Conversation;
  customerId: string;
  customerName: string;
  detectedLang: string;
  promptText: string;
  ackText: string;
  businessConnectionId?: string;
  chatId: string;
  senderId: string;
  updateId: number;
  repos: Repositories;
  client?: TelegramClient;
  managerChatId?: string;
  handoffReason?: string;
  intent?: string;
}): Promise<{ ackSent: boolean; managerNotified: boolean }> {
  const {
    conv,
    customerName,
    detectedLang,
    promptText,
    ackText,
    businessConnectionId,
    chatId,
    senderId,
    repos,
    client,
    managerChatId,
    handoffReason,
    intent,
  } = options;

  // 1. Get or Create Active PENDING Handoff for this conversation
  const convHandoffs = await repos.handoffs.findByConversationId(conv.id);
  let activeHandoff = convHandoffs.find((h) => h.status === 'PENDING');

  if (!activeHandoff) {
    activeHandoff = await repos.handoffs.create({
      conversationId: conv.id,
      customerId: conv.customerId,
      reason: handoffReason || 'CUSTOMER_REQUESTED_MANAGER',
      status: 'PENDING',
      priority: intent === 'complaint' ? 'high' : 'medium',
      metadata: { managerNotificationStatus: 'PENDING' },
    });
  }

  // 2. Customer Acknowledgment Delivery
  const convMessages = await repos.messages.findByConversationId(conv.id);
  const sentAckMsg = convMessages.find(
    (m) =>
      m.senderType === 'ai' &&
      m.status === 'SENT' &&
      (m.metadata as Record<string, unknown> | undefined)?.messageKind === 'handoff_ack'
  );

  let ackSent = Boolean(sentAckMsg);

  if (!sentAckMsg) {
    if (client) {
      try {
        const sentTelegramMsg = await sendTelegramTextMessage(client, {
          businessConnectionId,
          chatId,
          text: ackText,
          sendTyping: true,
        });

        await repos.messages.create({
          conversationId: conv.id,
          senderType: 'ai',
          content: ackText,
          contentType: 'text',
          status: 'SENT',
          metadata: {
            messageKind: 'handoff_ack',
            handoffId: activeHandoff.id,
            telegramMessageId: String(sentTelegramMsg.message_id),
          },
        });
        ackSent = true;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[Handoff Delivery Error] Customer acknowledgment failed to send:', errMsg);
        await repos.messages.create({
          conversationId: conv.id,
          senderType: 'ai',
          content: ackText,
          contentType: 'text',
          status: 'FAILED',
          metadata: {
            messageKind: 'handoff_ack',
            handoffId: activeHandoff.id,
            error: errMsg,
          },
        });
        ackSent = false;
      }
    } else {
      // Test/Dev mode without client -> NOT_SENT
      await repos.messages.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: ackText,
        contentType: 'text',
        status: 'NOT_SENT',
        metadata: {
          messageKind: 'handoff_ack',
          handoffId: activeHandoff.id,
        },
      });
      ackSent = false;
    }
  }

  // 3. Manager Group Notification Delivery (Atomic DB-level & Memory idempotency)
  const currentMeta = (activeHandoff.metadata || {}) as Record<string, unknown>;
  const mgrStatus = currentMeta.managerNotificationStatus;

  let managerNotified = mgrStatus === 'SENT';

  if (!managerNotified) {
    const claimed = await repos.handoffs.claimManagerNotificationDelivery(activeHandoff.id);
    if (claimed) {
      const targetManagerChatId = managerChatId || process.env.TELEGRAM_MANAGER_CHAT_ID;

      if (targetManagerChatId && client) {
        const channelLabel = businessConnectionId ? 'Telegram Business' : 'Telegram';
        const truncatedPrompt = promptText.length > 300 ? `${promptText.slice(0, 300)}...` : promptText;
        const priorityLabel = intent === 'complaint' ? 'HIGH' : 'MEDIUM';

        const notificationText =
          `🚨 Yangi handoff\n\n` +
          `Mijoz: ${customerName}\n` +
          `Telegram ID: ${senderId}\n` +
          `Conversation ID: ${conv.id}\n` +
          `Til: ${detectedLang}\n` +
          `Sababi: ${handoffReason || activeHandoff.reason || 'AI Handoff Triggered'}\n` +
          `Ustuvorlik: ${priorityLabel}\n` +
          `Oxirgi xabar: ${truncatedPrompt}\n` +
          `Kanal: ${channelLabel}\n` +
          `Vaqt: ${new Date().toISOString()}`;

        try {
          await sendTelegramTextMessage(client, {
            chatId: targetManagerChatId,
            text: notificationText,
          });

          const latestHandoff = await repos.handoffs.findById(activeHandoff.id);
          const latestMeta = (latestHandoff?.metadata || {}) as Record<string, unknown>;

          await repos.handoffs.update(activeHandoff.id, {
            metadata: {
              ...latestMeta,
              managerNotificationStatus: 'SENT',
              managerNotificationSentAt: new Date().toISOString(),
            },
          });
          managerNotified = true;
        } catch (err: unknown) {
          const rawErr = err instanceof Error ? err.message : String(err);
          const sanitizedErr = rawErr.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***:***');
          console.error('[Handoff Delivery Error] Manager notification failed to send:', sanitizedErr);

          const latestHandoff = await repos.handoffs.findById(activeHandoff.id);
          const latestMeta = (latestHandoff?.metadata || {}) as Record<string, unknown>;

          await repos.handoffs.update(activeHandoff.id, {
            metadata: {
              ...latestMeta,
              managerNotificationStatus: 'FAILED',
              managerNotificationError: sanitizedErr,
              managerNotificationFailedAt: new Date().toISOString(),
            },
          });
          managerNotified = false;
        }
      } else if (!targetManagerChatId) {
        console.warn('[Handoff Delivery Warning] TELEGRAM_MANAGER_CHAT_ID is missing or empty. Manager group notification skipped.');
      } else if (!client) {
        const latestHandoff = await repos.handoffs.findById(activeHandoff.id);
        const latestMeta = (latestHandoff?.metadata || {}) as Record<string, unknown>;

        await repos.handoffs.update(activeHandoff.id, {
          metadata: {
            ...latestMeta,
            managerNotificationStatus: 'NOT_SENT',
          },
        });
        managerNotified = false;
      }
    }
  }

  return { ackSent, managerNotified };
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

  // 2. Update Idempotency Check (Numeric update_id only - PostgreSQL BIGINT compatible)
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

  // 9. State Check: If conversation is WAITING_MANAGER, retry any pending handoff delivery then suppress AI sales replies
  if (conv.status !== 'AI_ACTIVE') {
    const convMessages = await repos.messages.findByConversationId(conv.id);
    const hasSentAck = convMessages.some(
      (m) =>
        m.senderType === 'ai' &&
        m.status === 'SENT' &&
        (m.metadata as Record<string, unknown> | undefined)?.messageKind === 'handoff_ack'
    );

    const convHandoffs = await repos.handoffs.findByConversationId(conv.id);
    const activeHandoff = convHandoffs.find((h) => h.status === 'PENDING');
    const hasNotifiedManager =
      (activeHandoff?.metadata as Record<string, unknown> | undefined)?.managerNotificationStatus === 'SENT';

    if (!hasSentAck || !hasNotifiedManager) {
      const ackText = getLocalizedTemplate(detectedLang).managerHandoff();
      await deliverHandoffNotifications({
        conv,
        customerId,
        customerName,
        detectedLang,
        promptText: normalized.text,
        ackText,
        businessConnectionId: normalized.businessConnectionId,
        chatId: normalized.chatId,
        senderId: normalized.senderId,
        updateId,
        repos,
        client,
        managerChatId,
      });
    }

    await repos.telegramReceipts.create({ updateId, updateType: 'message_saved_ai_inactive', status: 'PROCESSED' });
    return { status: 'PROCESSED', updateId, reason: `AI_INACTIVE_FOR_STATUS_${conv.status}` };
  }

  // 10. AI Response & Guardrail Processing via AIOrchestrator
  const convMessages = await repos.messages.findByConversationId(conv.id);
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

  // 11. Handoff Delivery Check: Customer Localized Acknowledgment & Manager Group Notification
  if (orchestratorResult.suppressAutoReply || orchestratorResult.needsHandoff) {
    const ackText = orchestratorResult.replyText;

    // Update conversation status to WAITING_MANAGER
    await repos.conversations.update(conv.id, {
      status: 'WAITING_MANAGER',
      lastMessageAt: new Date(),
    });

    const { ackSent } = await deliverHandoffNotifications({
      conv,
      customerId,
      customerName,
      detectedLang,
      promptText: normalized.text,
      ackText,
      businessConnectionId: normalized.businessConnectionId,
      chatId: normalized.chatId,
      senderId: normalized.senderId,
      updateId,
      repos,
      client,
      managerChatId,
      handoffReason: orchestratorResult.handoffReason,
      intent: orchestratorResult.intent,
    });

    await repos.telegramReceipts.create({
      updateId,
      updateType: 'handoff_delivered',
      status: ackSent ? 'PROCESSED' : 'FAILED',
    });

    return {
      status: 'PROCESSED',
      updateId,
      updateType: 'message',
      reason: 'HANDOFF_DELIVERED',
    };
  }

  // 12. Send Standard Outgoing Reply via Telegram Client
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
    // Development / Test mode without client -> NOT_SENT
    await repos.messages.create({
      conversationId: conv.id,
      senderType: 'ai',
      content: replyText,
      contentType: 'text',
      status: 'NOT_SENT',
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
