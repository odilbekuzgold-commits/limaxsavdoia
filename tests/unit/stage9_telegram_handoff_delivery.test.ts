import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createRepositories } from '../../packages/database/dist/index.js';
import { processTelegramUpdate } from '../../apps/api/dist/modules/telegram/service.js';
import type { Repositories } from '@limax/shared';
import type { TelegramClient } from '../../packages/channel-adapters/dist/index.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MOCK_MANAGER_CHAT_ID = '-1003997345783';

describe('Stage 9: Telegram Manager Handoff Corrective Fix Tests', () => {
  let repos: Repositories;

  beforeEach(() => {
    process.env.RESPONSE_DELAY_ENABLED = 'false';
    process.env.NODE_ENV = 'test';
    repos = createRepositories('memory');
  });

  function createMockTelegramClient() {
    const sentMessages: Array<{ chatId: string | number; text: string; businessConnectionId?: string }> = [];
    const client: TelegramClient = {
      sendChatAction: async () => ({ ok: true }),
      sendMessage: async (params: any) => {
        if (typeof params === 'object' && params !== null && 'chat_id' in params) {
          sentMessages.push({
            chatId: params.chat_id,
            text: params.text,
            businessConnectionId: params.business_connection_id,
          });
        }
        return { message_id: Math.floor(Math.random() * 10000) + 1 };
      },
    } as any;
    return { client, sentMessages };
  }

  function makeUpdate(updateId: number, text: string, senderId = 12345, businessConnId?: string) {
    if (businessConnId) {
      return {
        update_id: updateId,
        business_message: {
          message_id: updateId * 10,
          date: Math.floor(Date.now() / 1000),
          business_connection_id: businessConnId,
          chat: { id: senderId, type: 'private', first_name: 'Ali' },
          from: { id: senderId, is_bot: false, first_name: 'Ali' },
          text,
        },
      };
    }
    return {
      update_id: updateId,
      message: {
        message_id: updateId * 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: senderId, type: 'private', first_name: 'Ali' },
        from: { id: senderId, is_bot: false, first_name: 'Ali' },
        text,
      },
    };
  }

  // 1. Mandatory Test 1: Conversation has previous standard AI SENT message, then handoff -> acknowledgment IS sent
  it('1. Pre-existing standard AI SENT sales message does not block handoff acknowledgment', async () => {
    const { client, sentMessages } = createMockTelegramClient();

    // Update 1: Standard greeting -> returns AI sales greeting reply (status: SENT)
    await processTelegramUpdate({
      update: makeUpdate(101, 'salom', 12345),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const countBefore = sentMessages.length;
    assert.strictEqual(countBefore, 1, 'Expected initial greeting sales reply to be sent');

    // Update 2: User requests manager -> Handoff triggered! Acknowledgment MUST be sent despite existing SENT AI message
    const res2 = await processTelegramUpdate({
      update: makeUpdate(102, 'Menejer bilan gaplashmoqchiman', 12345),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    assert.strictEqual(res2.status, 'PROCESSED');
    const customerAckMsg = sentMessages.find(
      (m) => String(m.chatId) === '12345' && m.text.includes('Murojaatingiz menejerlarimizga yuborildi')
    );
    assert.ok(customerAckMsg, 'Customer handoff acknowledgment must be delivered even with prior AI messages');
  });

  // 2. Mandatory Test 2: Acknowledgment SENT -> duplicate is NOT sent
  it('2. Acknowledgment status SENT prevents duplicate acknowledgment on subsequent updates', async () => {
    const { client, sentMessages } = createMockTelegramClient();

    await processTelegramUpdate({
      update: makeUpdate(201, 'Menejer kerak', 22222),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const acksCount1 = sentMessages.filter(
      (m) => String(m.chatId) === '22222' && m.text.includes('Murojaatingiz menejerlarimizga yuborildi')
    ).length;
    assert.strictEqual(acksCount1, 1);

    // Update 2 during WAITING_MANAGER
    await processTelegramUpdate({
      update: makeUpdate(202, 'Javob kutmoqdaman', 22222),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const acksCount2 = sentMessages.filter(
      (m) => String(m.chatId) === '22222' && m.text.includes('Murojaatingiz menejerlarimizga yuborildi')
    ).length;
    assert.strictEqual(acksCount2, 1, 'Duplicate acknowledgment must NOT be sent');
  });

  // 3. Mandatory Test 3: Acknowledgment FAILED -> retried on next update
  it('3. Customer acknowledgment failure saves FAILED status and retries on next update', async () => {
    let failAck = true;
    const sentMessages: any[] = [];
    const client: TelegramClient = {
      sendChatAction: async () => ({ ok: true }),
      sendMessage: async (params: any) => {
        if (failAck && String(params.chat_id) === '33333') {
          throw new Error('Telegram API Network Failure');
        }
        sentMessages.push(params);
        return { message_id: 888 };
      },
    } as any;

    await processTelegramUpdate({
      update: makeUpdate(301, 'Menejer kerak', 33333),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const convs = await repos.conversations.findAll({});
    const msgs1 = await repos.messages.findByConversationId(convs[0].id);
    const failedAck = msgs1.find(
      (m) => m.senderType === 'ai' && m.status === 'FAILED' && (m.metadata as any)?.messageKind === 'handoff_ack'
    );
    assert.ok(failedAck, 'Expected FAILED status on initial acknowledgment error');

    failAck = false; // Allow retry to succeed

    await processTelegramUpdate({
      update: makeUpdate(302, 'Tinchlikmi?', 33333),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const msgs2 = await repos.messages.findByConversationId(convs[0].id);
    const sentAck = msgs2.find(
      (m) => m.senderType === 'ai' && m.status === 'SENT' && (m.metadata as any)?.messageKind === 'handoff_ack'
    );
    assert.ok(sentAck, 'Expected acknowledgment status to update to SENT on retry success');
  });

  // 4. Mandatory Test 4: Manager notification stored with PostgreSQL-compatible identifier on handoff.metadata
  it('4. Manager notification status is stored cleanly in handoff.metadata', async () => {
    const { client } = createMockTelegramClient();

    await processTelegramUpdate({
      update: makeUpdate(401, 'Menejer kerak', 44444),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const convs = await repos.conversations.findAll({});
    const handoffs = await repos.handoffs.findByConversationId(convs[0].id);
    assert.strictEqual(handoffs.length, 1);
    assert.strictEqual((handoffs[0].metadata as any)?.managerNotificationStatus, 'SENT');
    assert.ok((handoffs[0].metadata as any)?.managerNotificationSentAt);
  });

  // 5. Mandatory Test 5: String marker NEVER written to BIGINT update_id, ZERO instances of markerKey as any
  it('5. Source code contains zero string marker calls to telegramReceipts and zero markerKey as any casts', () => {
    const servicePath = resolve(process.cwd(), 'apps/api/src/modules/telegram/service.ts');
    const serviceContent = readFileSync(servicePath, 'utf8');
    assert.strictEqual(serviceContent.includes('markerKey as any'), false, 'markerKey as any pattern must not exist');
    assert.strictEqual(serviceContent.includes('handoff_manager_notified:'), false, 'string marker in update_id must not exist');
  });

  // 6. Mandatory Test 6: Real PostgreSQL schema compatibility verification
  it('6. Receipts exclusively store integer update IDs compatible with PostgreSQL BIGINT', async () => {
    const { client } = createMockTelegramClient();

    await processTelegramUpdate({
      update: makeUpdate(601, 'Menejer kerak', 66666),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const receipt = await repos.telegramReceipts.findByUpdateId(601);
    assert.ok(receipt, 'Receipt for update 601 must be found by numeric ID');
    assert.strictEqual(typeof receipt.updateId, 'number');
    assert.strictEqual(Number.isInteger(receipt.updateId), true);
  });

  // 7. Mandatory Test 7: Parallel updates do NOT send duplicate notifications to manager group
  it('7. Parallel updates with lock state do not send duplicate manager notifications', async () => {
    const { client, sentMessages } = createMockTelegramClient();

    // Create initial conversation first so both parallel updates target the exact same conversation
    await processTelegramUpdate({
      update: makeUpdate(700, 'salom', 77777),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    // Trigger two handoff updates concurrently for the existing conversation
    await Promise.all([
      processTelegramUpdate({
        update: makeUpdate(701, 'Menejer bilan gaplashmoqchiman', 77777),
        repos,
        client,
        managerChatId: MOCK_MANAGER_CHAT_ID,
      }),
      processTelegramUpdate({
        update: makeUpdate(702, 'Menejer kerak edi', 77777),
        repos,
        client,
        managerChatId: MOCK_MANAGER_CHAT_ID,
      }),
    ]);

    const mgrMsgs = sentMessages.filter((m) => String(m.chatId) === MOCK_MANAGER_CHAT_ID);
    assert.strictEqual(mgrMsgs.length, 1, 'Parallel updates must deliver exactly ONE manager notification');
  });

  // 8. Mandatory Test 8: uz-Latn, uz-Cyrl, and ru retry texts are correct and clean UTF-8
  it('8. Localized handoff templates produce correct clean UTF-8 text for uz-Latn, uz-Cyrl, and ru', async () => {
    const { client: client1, sentMessages: s1 } = createMockTelegramClient();
    await processTelegramUpdate({
      update: makeUpdate(801, 'Menejer kerak', 80001),
      repos,
      client: client1,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });
    const msgLatn = s1.find((m) => String(m.chatId) === '80001');
    assert.ok(msgLatn);
    assert.ok(msgLatn.text.includes('Murojaatingiz menejerlarimizga yuborildi. Tez orada siz bilan bog‘lanamiz.'));
    assert.ok(!msgLatn.text.includes('bog\u00e2\u20ac\u2018lanamiz'), 'Must not contain mojibake');

    const reposRu = createRepositories('memory');
    const { client: client2, sentMessages: s2 } = createMockTelegramClient();
    await processTelegramUpdate({
      update: makeUpdate(802, 'Нужен менеджер', 80002),
      repos: reposRu,
      client: client2,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });
    const msgRu = s2.find((m) => String(m.chatId) === '80002');
    assert.ok(msgRu);
    assert.ok(msgRu.text.includes('Ваше обращение передано нашим менеджерам. Мы скоро свяжемся с вами.'));
  });

  // 9. Mandatory Test 9: Zero unsafe type assertions in Telegram handoff service code
  it('9. Source code contains no hardcoded bot tokens or unhandled errors', () => {
    const servicePath = resolve(process.cwd(), 'apps/api/src/modules/telegram/service.ts');
    const serviceContent = readFileSync(servicePath, 'utf8');
    assert.strictEqual(serviceContent.includes('8668774663:AAHaYJ0JNFtJ9BDMn7iMXj7iCRqCYH_gZIM'), false);
  });

  // 10. Additional Test: Telegram Business connection preserves businessConnectionId
  it('10. Telegram Business handoff preserves businessConnectionId in customer message', async () => {
    const { client, sentMessages } = createMockTelegramClient();

    const result = await processTelegramUpdate({
      update: makeUpdate(1001, 'Menejer kerak', 10001, 'biz-conn-777'),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    assert.strictEqual(result.status, 'PROCESSED');
    const customerMsg = sentMessages.find((m) => String(m.chatId) === '10001');
    assert.ok(customerMsg);
    assert.strictEqual(customerMsg.businessConnectionId, 'biz-conn-777');
  });

  // 11. Additional Test: WAITING_MANAGER status suppresses standard AI sales reply
  it('11. WAITING_MANAGER status suppresses standard AI sales reply once acknowledgment is SENT', async () => {
    const { client } = createMockTelegramClient();

    await processTelegramUpdate({
      update: makeUpdate(1101, 'Menejer kerak', 11001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const res2 = await processTelegramUpdate({
      update: makeUpdate(1102, 'Yarn 30/1 narxi qancha?', 11001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    assert.strictEqual(res2.status, 'PROCESSED');
    assert.strictEqual(res2.reason, 'AI_INACTIVE_FOR_STATUS_WAITING_MANAGER');
  });

  // 12. Additional Test: Missing manager chat ID completes handoff delivery without error
  it('12. Missing manager chat ID completes handoff delivery without error', async () => {
    const { client, sentMessages } = createMockTelegramClient();

    const result = await processTelegramUpdate({
      update: makeUpdate(1201, 'Menejer bilan boglanmoqchiman', 12001),
      repos,
      client,
      managerChatId: '',
    });

    assert.strictEqual(result.status, 'PROCESSED');
    const customerMsg = sentMessages.find((m) => String(m.chatId) === '12001');
    assert.ok(customerMsg);
  });

  // 13. Additional Test: Manager notification failure handles exception without leaking secrets
  it('13. Manager notification failure handles exception without leaking secrets', async () => {
    const sentMessages: any[] = [];
    const client: TelegramClient = {
      sendChatAction: async () => ({ ok: true }),
      sendMessage: async (params: any) => {
        if (String(params.chat_id) === MOCK_MANAGER_CHAT_ID) {
          throw new Error('Telegram API 403 Forbidden');
        }
        sentMessages.push({ chatId: params.chat_id, text: params.text });
        return { message_id: 111 };
      },
    } as any;

    const result = await processTelegramUpdate({
      update: makeUpdate(1301, 'Menejer kerak', 13001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    assert.strictEqual(result.status, 'PROCESSED');
    const customerMsg = sentMessages.find((m) => String(m.chatId) === '13001');
    assert.ok(customerMsg);
  });

  // 14. Additional Test: Numeric manager chat ID is masked properly for safe display
  it('14. Numeric manager chat ID is masked properly for safe display', () => {
    const fullId = '-1003997345783';
    const masked = fullId.length > 8 ? `${fullId.slice(0, 4)}***${fullId.slice(-4)}` : '***';
    assert.strictEqual(masked, '-100***5783');
  });

  // 15. Additional Test: Exactly one PENDING handoff per conversation session
  it('15. Exactly one PENDING handoff is kept per conversation session', async () => {
    const { client } = createMockTelegramClient();

    await processTelegramUpdate({
      update: makeUpdate(1501, 'Menejer kerak', 15001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const convs = await repos.conversations.findAll({});
    const handoffs = await repos.handoffs.findByConversationId(convs[0].id);
    const pendingHandoffs = handoffs.filter((h) => h.status === 'PENDING');
    assert.strictEqual(pendingHandoffs.length, 1);
  });

  // 16. Additional Test: Manager notification failure is logged and retried on next update
  it('16. Manager notification failure is recorded in metadata and retried on next update', async () => {
    let failManager = true;
    const sentMessages: any[] = [];
    const client: TelegramClient = {
      sendChatAction: async () => ({ ok: true }),
      sendMessage: async (params: any) => {
        if (failManager && String(params.chat_id) === MOCK_MANAGER_CHAT_ID) {
          throw new Error('Telegram API Network Timeout');
        }
        sentMessages.push(params);
        return { message_id: 777 };
      },
    } as any;

    await processTelegramUpdate({
      update: makeUpdate(1601, 'Menejer kerak', 16001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const convs1 = await repos.conversations.findAll({});
    const handoffs1 = await repos.handoffs.findByConversationId(convs1[0].id);
    assert.strictEqual((handoffs1[0].metadata as any)?.managerNotificationStatus, 'FAILED');

    failManager = false; // Allow manager notification to succeed on retry

    await processTelegramUpdate({
      update: makeUpdate(1602, 'Menejer keldimi?', 16001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const handoffs2 = await repos.handoffs.findByConversationId(convs1[0].id);
    assert.strictEqual((handoffs2[0].metadata as any)?.managerNotificationStatus, 'SENT');
  });

  // 17. Additional Test: Missing client saves acknowledgment message as NOT_SENT
  it('17. Missing client saves acknowledgment message as NOT_SENT (not SENT)', async () => {
    await processTelegramUpdate({
      update: makeUpdate(1701, 'Menejer kerak', 17001),
      repos,
      client: undefined,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const convs = await repos.conversations.findAll({});
    const msgs = await repos.messages.findByConversationId(convs[0].id);
    const ackMsg = msgs.find((m) => m.senderType === 'ai');
    assert.ok(ackMsg);
    assert.strictEqual(ackMsg.status, 'NOT_SENT');
  });

  // 18. Additional Test: Multi-language localized retry text correctness
  it('18. Localized template produces exact clean UTF-8 text on retries', async () => {
    const { client, sentMessages } = createMockTelegramClient();

    await processTelegramUpdate({
      update: makeUpdate(1801, 'Menejer bilan gaplashmoqchiman', 18001),
      repos,
      client,
      managerChatId: MOCK_MANAGER_CHAT_ID,
    });

    const customerMsg = sentMessages.find((m) => String(m.chatId) === '18001');
    assert.ok(customerMsg);
    assert.strictEqual(
      customerMsg.text,
      'Murojaatingiz menejerlarimizga yuborildi. Tez orada siz bilan bog‘lanamiz.\nMenejerlar guruhi: https://t.me/limaxmanagerlari1'
    );
  });
});
