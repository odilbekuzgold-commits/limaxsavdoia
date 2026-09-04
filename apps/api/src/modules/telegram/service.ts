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

function getManagerReasonLabel(handoffReason?: string, intent?: string): string {
  if (intent === 'complaint') return 'Mijoz shikoyat qildi';
  if (intent === 'manager_request') return 'Mijoz menejer bilan gaplashmoqchi';

  switch (handoffReason) {
    case 'FALLBACK_FAILED':
    case 'PROVIDER_FAILURE':
      return 'Bot javob bera olmadi';
    case 'MISSING_ACTIVE_PRICE':
      return 'Amaldagi narxni aniqlashtirish kerak';
    case 'NO_RELIABLE_KNOWLEDGE':
      return 'Ma’lumotni aniqlashtirish kerak';
    case 'CUSTOMER_REQUESTED_MANAGER':
      return 'Mijoz menejer bilan gaplashmoqchi';
    default:
      return 'Murojaat menejer ko‘rigini talab qildi';
  }
}

function formatTashkentTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

function getLanguageLabel(language?: string): string {
  switch (language) {
    case 'uz-Cyrl':
      return 'Uzbek (Kirill)';
    case 'ru':
      return 'Russian';
    case 'tg':
      return 'Tajik';
    case 'kk':
      return 'Kazakh';
    case 'ky':
      return 'Kyrgyz';
    default:
      return 'Uzbek';
  }
}

export function formatManagerHandoffNotification(input: {
  customerName: string;
  promptText: string;
  telegramId?: string;
  username?: string;
  phone?: string;
  companyName?: string;
  location?: string;
  language?: string;
  product?: string;
  color?: string;
  quantity?: string;
  deadline?: string;
  leadTemperature?: 'COLD' | 'WARM' | 'HOT';
  handoffReason?: string;
  intent?: string;
  createdAt?: Date;
}): string {
  const truncatedPrompt = input.promptText.length > 300
    ? `${input.promptText.slice(0, 300)}...`
    : input.promptText;
  const priorityLabel = input.intent === 'complaint' ? 'Yuqori' : 'O‘rta';
  const username = input.username
    ? (input.username.startsWith('@') ? input.username : `@${input.username}`)
    : undefined;
  const lines = ['🚨 Yangi handoff', '', `👤 Mijoz: ${input.customerName}`];

  if (input.phone) lines.push(`📱 Telefon: ${input.phone}`);
  if (username) lines.push(`🔗 Username: ${username}`);
  if (input.telegramId) lines.push(`🆔 Telegram ID: ${input.telegramId}`);

  lines.push('');
  if (input.companyName) lines.push(`🏢 Kompaniya: ${input.companyName}`);
  if (input.location) lines.push(`📍 Hudud: ${input.location}`);
  lines.push('🌐 Kanal: Telegram');
  lines.push(`🗣 Til: ${getLanguageLabel(input.language)}`);

  if (input.product || input.color || input.quantity || input.deadline) lines.push('');
  if (input.product) lines.push(`🧵 Qiziqqan mahsulot: ${input.product}`);
  if (input.color) lines.push(`🎨 Rang: ${input.color}`);
  if (input.quantity) lines.push(`📦 Miqdor: ${input.quantity}`);
  if (input.deadline) lines.push(`⏰ Qachonga kerak: ${input.deadline}`);

  lines.push('');
  lines.push(`❗ Sabab: ${getManagerReasonLabel(input.handoffReason, input.intent)}`);
  lines.push(`📩 Oxirgi xabar: “${truncatedPrompt}”`);
  if (input.leadTemperature) lines.push(`🔥 Lead: ${input.leadTemperature}`);
  lines.push(`⚡ Ustuvorlik: ${priorityLabel}`);
  lines.push('');
  lines.push(`🕒 Vaqt: ${formatTashkentTime(input.createdAt || new Date())}`);

  return lines.join('\n');
}

function extractHandoffColor(text: string): string | undefined {
  if (/\b(mix\s*color|mic\s*color|mixed\s*color|аралаш\s*ранг)\b/iu.test(text)) return 'MIX COLOR';
  if (/\b(white|oq|ок|белый|белая)\b/iu.test(text)) return 'WHITE';
  if (/\b(black|qora|кора|чёрный|черный|чёрная|черная)\b/iu.test(text)) return 'BLACK';
  return undefined;
}

function extractHandoffDeadline(text: string): string | undefined {
  if (/\b(bugun|бугун|today|сегодня)\b/iu.test(text)) return 'Bugun';
  if (/\b(ertaga|эртага|tomorrow|завтра)\b/iu.test(text)) return 'Ertaga';

  const numericDate = text.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/u)?.[0];
  if (numericDate) return numericDate;

  const namedDate = text.match(/\b\d{1,2}\s*-?\s*(?:yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr)\b/iu)?.[0];
  return namedDate;
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
  username?: string;
  phone?: string;
  companyName?: string;
  location?: string;
  product?: string;
  color?: string;
  quantity?: string;
  deadline?: string;
  leadTemperature?: 'COLD' | 'WARM' | 'HOT';
  repos: Repositories;
  client?: TelegramClient;
  managerChatId?: string;
  handoffReason?: string;
  intent?: string;
}): Promise<{ ackSent: boolean; managerNotified: boolean }> {
  const {
    conv,
    customerName,
    promptText,
    ackText,
    businessConnectionId,
    chatId,
    senderId,
    detectedLang,
    username,
    phone,
    companyName,
    location,
    product,
    color,
    quantity,
    deadline,
    leadTemperature,
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
        const notificationText = formatManagerHandoffNotification({
          customerName,
          promptText,
          telegramId: senderId,
          username,
          phone,
          companyName,
          location,
          language: detectedLang,
          product,
          color,
          quantity,
          deadline,
          leadTemperature,
          handoffReason: handoffReason || activeHandoff.reason,
          intent,
        });

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

  // 9. State Check: Suppress standard AI replies if conversation is WAITING_MANAGER, BLOCKED, or CLOSED
  if (conv.status === 'BLOCKED' || conv.status === 'CLOSED') {
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

  // 10.5. Automatic Lead Capture & Qualification into Dashboard
  const textLower = (normalized.text || '').toLowerCase();
  const qtyMatch = textLower.match(/(\d+(?:\.\d+)?)\s*(kg|tonna|tn|karobka|bobina|dona)/i);
  const detectedQuantity = qtyMatch ? `${qtyMatch[1]} ${qtyMatch[2]}` : undefined;
  const detectedProduct =
    orchestratorResult.leadSignals?.productNeed ||
    (textLower.includes('30/70') ? '30/70' : textLower.includes('40100') ? '40100K' : textLower.includes('spun') ? 'Spun 32S' : undefined);
  const recentCustomerText = convMessages
    .filter((message) => message.senderType === 'customer')
    .slice(-6)
    .map((message) => message.content)
    .join(' ');
  const detectedColor = extractHandoffColor(recentCustomerText);
  const detectedDeadline = extractHandoffDeadline(recentCustomerText);
  let productForNotification = detectedProduct;
  let leadTemperature: 'COLD' | 'WARM' | 'HOT' = detectedQuantity ? 'HOT' : 'WARM';

  if (detectedProduct || detectedQuantity || orchestratorResult.needsHandoff) {
    try {
      const allLeads = await repos.leads.findAll({});
      const existingLead = allLeads.find((l) => l.customerId === customerId);

      if (!productForNotification && existingLead?.productInterest) {
        productForNotification = existingLead.productInterest;
      }
      if (!detectedQuantity && existingLead?.temperature) {
        leadTemperature = existingLead.temperature;
      }

      const productInterest = detectedProduct ? `${detectedProduct}${detectedQuantity ? ` (${detectedQuantity})` : ''}` : 'Ip mahsuloti';
      const temperature = leadTemperature;
      const score = detectedQuantity ? 85 : 65;

      if (!existingLead) {
        await repos.leads.create({
          customerId,
          conversationId: conv.id,
          productInterest,
          temperature,
          score,
          stage: detectedQuantity ? 'proposal' : 'qualifying',
          nextAction: 'Menejer bog‘lanishi va buyurtmani rasmiylashtirishi kerak',
        });
      } else {
        await repos.leads.update(existingLead.id, {
          productInterest: productInterest || existingLead.productInterest,
          temperature,
          score: Math.max(existingLead.score || 0, score),
          stage: detectedQuantity ? 'proposal' : existingLead.stage,
          nextAction: 'Mijoz yangi miqdor/mahsulot so‘radi',
        });
      }
    } catch (leadErr) {
      console.warn('[Lead Capture Non-Blocking Error]:', leadErr);
    }
  }

  // 11. Handoff Recording (Notify manager in background if needed)
  let handoffDelivery: { ackSent: boolean; managerNotified: boolean } | null = null;

  if (orchestratorResult.needsHandoff) {
    await repos.conversations.update(conv.id, {
      status: 'WAITING_MANAGER',
      lastMessageAt: new Date(),
    });

    try {
      handoffDelivery = await deliverHandoffNotifications({
        conv,
        customerId,
        customerName,
        detectedLang,
        promptText: normalized.text,
        ackText: orchestratorResult.replyText,
        businessConnectionId: normalized.businessConnectionId,
        chatId: normalized.chatId,
        senderId: normalized.senderId,
        updateId,
        username: contact.username || normalized.senderUsername,
        phone: contact.phone,
        product: productForNotification,
        color: detectedColor,
        quantity: detectedQuantity,
        deadline: detectedDeadline,
        leadTemperature,
        repos,
        client,
        managerChatId,
        handoffReason: orchestratorResult.handoffReason,
        intent: orchestratorResult.intent,
      });
    } catch (err) {
      console.warn('[Handoff Notification Non-Blocking Error]:', err);
    }
  }

  // 12. Send Standard Outgoing Reply to Customer via Telegram Client
  const replyText = orchestratorResult.replyText;

  if (client && replyText && (!orchestratorResult.needsHandoff || !handoffDelivery?.ackSent)) {
    try {
      if (process.env.RESPONSE_DELAY_ENABLED === 'true') {
        const minMs = parseInt(process.env.RESPONSE_DELAY_MIN_MS || '500', 10);
        const maxMs = parseInt(process.env.RESPONSE_DELAY_MAX_MS || '1500', 10);
        const perCharMs = parseInt(process.env.RESPONSE_DELAY_PER_CHAR_MS || '10', 10);

        const charDelay = replyText.length * perCharMs;
        const randomJitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        const totalDelayMs = Math.min(3000, charDelay + randomJitter);

        await new Promise((resolve) => setTimeout(resolve, totalDelayMs));
      }

      const sentTelegramMsg = await sendTelegramTextMessage(client, {
        businessConnectionId: normalized.businessConnectionId,
        chatId: normalized.chatId,
        text: replyText,
        sendTyping: true,
      });
      console.log(`[Telegram Sent Success] Sent reply to ${normalized.chatId}: ${replyText.substring(0, 60)}...`);

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
      console.error('[Telegram Send Error]:', errMsg);
      await repos.messages.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: replyText,
        contentType: 'text',
        status: 'FAILED',
        metadata: { error: errMsg },
      });
    }
  } else if (replyText) {
    // Development / Test mode without client -> NOT_SENT
    await repos.messages.create({
      conversationId: conv.id,
      senderType: 'ai',
      content: replyText,
      contentType: 'text',
      status: 'NOT_SENT',
      metadata: {},
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
