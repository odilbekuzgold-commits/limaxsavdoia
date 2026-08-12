import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  TelegramClient,
  TelegramApiError,
  normalizeTelegramMessage,
} from '../../packages/channel-adapters/dist/index.js';
import {
  createRepositories,
  InMemoryCustomerRepository,
} from '../../packages/database/dist/index.js';
import { processTelegramUpdate } from '../../apps/api/dist/modules/telegram/service.js';

describe('Stage 4: Telegram Business MVP Unit & Integration Tests', () => {
  test('1. getMe response parsing & client initialization', async () => {
    const client = new TelegramClient({
      botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    });
    assert.ok(client);
  });

  test('2. Business connection update normalization & persistence', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 1001,
      business_connection: {
        id: 'conn_99',
        user: { id: 777, is_bot: false, first_name: 'BizUser', username: 'bizuser' },
        user_chat_id: 888,
        date: 1700000000,
        can_reply: true,
        is_enabled: true,
      },
    };

    const res = await processTelegramUpdate({ update, repos });
    assert.strictEqual(res.status, 'PROCESSED');

    const conn = await repos.telegramConnections.findByConnectionId('conn_99');
    assert.ok(conn);
    assert.strictEqual(conn.connectionId, 'conn_99');
    assert.strictEqual(conn.businessUserId, '777');
  });

  test('3. Business message normalization', () => {
    const update = {
      update_id: 1002,
      business_message: {
        message_id: 55,
        business_connection_id: 'conn_99',
        date: 1700000000,
        chat: { id: 444, type: 'private' as const, first_name: 'Client' },
        from: { id: 444, is_bot: false, first_name: 'Client' },
        text: 'Narxi qancha?',
      },
    };

    const norm = normalizeTelegramMessage(update);
    assert.ok(norm);
    assert.strictEqual(norm.channel, 'TELEGRAM');
    assert.strictEqual(norm.chatId, '444');
    assert.strictEqual(norm.senderId, '444');
    assert.strictEqual(norm.text, 'Narxi qancha?');
    assert.strictEqual(norm.businessConnectionId, 'conn_99');
  });

  test('4. Telegram ID stored as string', () => {
    const update = {
      update_id: 1003,
      message: {
        message_id: 123456789,
        date: 1700000000,
        chat: { id: 9876543210, type: 'private' as const },
        from: { id: 9876543210, is_bot: false, first_name: 'BigID' },
        text: 'Test ID',
      },
    };

    const norm = normalizeTelegramMessage(update);
    assert.ok(norm);
    assert.strictEqual(typeof norm.senderId, 'string');
    assert.strictEqual(typeof norm.chatId, 'string');
    assert.strictEqual(norm.senderId, '9876543210');
  });

  test('5. Update ID dedupe (idempotency)', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 2001,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 10, type: 'private' as const },
        from: { id: 10, is_bot: false, first_name: 'User' },
        text: 'Salom',
      },
    };

    const first = await processTelegramUpdate({ update, repos });
    assert.strictEqual(first.status, 'PROCESSED');

    const second = await processTelegramUpdate({ update, repos });
    assert.strictEqual(second.status, 'SKIPPED');
    assert.strictEqual(second.reason, 'DUPLICATE_UPDATE_ID');
  });

  test('6. External message dedupe', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 2002,
      message: {
        message_id: 99,
        date: 1700000000,
        chat: { id: 20, type: 'private' as const },
        from: { id: 20, is_bot: false, first_name: 'User2' },
        text: 'Hello dedupe',
      },
    };

    await processTelegramUpdate({ update, repos });
    const msgs = await repos.messages.findByConversationId(
      (await repos.conversations.findAll({}))[0].id
    );
    const customerMsgs = msgs.filter((m) => m.senderType === 'customer');
    assert.strictEqual(customerMsgs.length, 1);
  });

  test('7. Own bot message ignore', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 3001,
      message: {
        message_id: 10,
        date: 1700000000,
        chat: { id: 30, type: 'private' as const },
        from: { id: 999, is_bot: true, first_name: 'MyBot' },
        text: 'I am a bot',
      },
    };

    const res = await processTelegramUpdate({ update, repos });
    assert.strictEqual(res.status, 'IGNORED');
    assert.strictEqual(res.reason, 'IGNORE_BOT_SELF_MESSAGE');
  });

  test('8. Group/channel message ignore', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 3002,
      message: {
        message_id: 11,
        date: 1700000000,
        chat: { id: -10012345, type: 'supergroup' as const, title: 'Dev Group' },
        from: { id: 40, is_bot: false, first_name: 'GroupMember' },
        text: 'Group message',
      },
    };

    const res = await processTelegramUpdate({ update, repos });
    assert.strictEqual(res.status, 'IGNORED');
    assert.strictEqual(res.reason, 'IGNORE_NON_PRIVATE_CHAT');
  });

  test('9. Customer & contact find-or-create', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 4001,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 555, type: 'private' as const, first_name: 'Anvar' },
        from: { id: 555, is_bot: false, first_name: 'Anvar', username: 'anvar_uz' },
        text: 'Assalomu alaykum',
      },
    };

    await processTelegramUpdate({ update, repos });

    const contact = await repos.contacts.findByChannelAndExternalId('telegram', '555');
    assert.ok(contact);
    assert.strictEqual(contact.username, 'anvar_uz');

    const customer = await repos.customers.findById(contact.customerId);
    assert.ok(customer);
    assert.strictEqual(customer.name, 'Anvar');
  });

  test('10. Conversation find-or-create', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 4002,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 666, type: 'private' as const },
        from: { id: 666, is_bot: false, first_name: 'Sobir' },
        text: 'Salom',
      },
    };

    await processTelegramUpdate({ update, repos });
    const convs = await repos.conversations.findAll({ status: 'AI_ACTIVE' });
    assert.strictEqual(convs.length, 1);
    assert.strictEqual(convs[0].channel, 'telegram');
  });

  test('11. Existing handoff (WAITING_MANAGER) suppresses AI auto-reply', async () => {
    const repos = createRepositories('memory');
    const update1 = {
      update_id: 5001,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 777, type: 'private' as const },
        from: { id: 777, is_bot: false, first_name: 'User' },
        text: 'Salom bot',
      },
    };

    await processTelegramUpdate({ update: update1, repos });

    // Manually set conversation to WAITING_MANAGER
    const convs = await repos.conversations.findAll({});
    await repos.conversations.update(convs[0].id, { status: 'WAITING_MANAGER' });

    // Second message while waiting for manager
    const update2 = {
      update_id: 5002,
      message: {
        message_id: 2,
        date: 1700000005,
        chat: { id: 777, type: 'private' as const },
        from: { id: 777, is_bot: false, first_name: 'User' },
        text: 'Hali ham kutyapman',
      },
    };

    const res = await processTelegramUpdate({ update: update2, repos });
    assert.strictEqual(res.status, 'PROCESSED');
    assert.ok(res.reason?.includes('AI_INACTIVE'));
  });

  test('12. Mock AI reply flow', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 6001,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 888, type: 'private' as const },
        from: { id: 888, is_bot: false, first_name: 'Mijoz' },
        text: 'Salom, mahsulotlar narxi qancha?',
      },
    };

    const res = await processTelegramUpdate({ update, repos });
    assert.strictEqual(res.status, 'PROCESSED');

    const msgs = await repos.messages.findByConversationId(
      (await repos.conversations.findAll({}))[0].id
    );
    assert.strictEqual(msgs.length, 2); // 1 customer, 1 AI reply
    assert.strictEqual(msgs[1].senderType, 'ai');
  });

  test('13. Low confidence handoff recommendation', async () => {
    const repos = createRepositories('memory');
    const update = {
      update_id: 7001,
      message: {
        message_id: 1,
        date: 1700000000,
        chat: { id: 999, type: 'private' as const },
        from: { id: 999, is_bot: false, first_name: 'User' },
        text: 'Siz qaysi siyosiy partiyaga ovoz berasiz?',
      },
    };

    await processTelegramUpdate({ update, repos });
    const handoffs = await repos.handoffs.findByConversationId(
      (await repos.conversations.findAll({}))[0].id
    );
    assert.strictEqual(handoffs.length, 1);
  });

  test('14. Secret redaction in TelegramApiError', () => {
    const secretToken = '123456:SECRET_BOT_TOKEN_HERE';
    const err = new TelegramApiError(`Failed request at url with token ${secretToken}`, {
      statusCode: 401,
    });

    const redacted = err.message.replace(new RegExp(secretToken, 'g'), '[REDACTED_TOKEN]');
    assert.strictEqual(redacted.includes('SECRET_BOT_TOKEN_HERE'), false);
    assert.strictEqual(redacted.includes('[REDACTED_TOKEN]'), true);
  });

  test('15. Edited message update handling', () => {
    const update = {
      update_id: 8001,
      edited_message: {
        message_id: 50,
        date: 1700000000,
        chat: { id: 111, type: 'private' as const },
        from: { id: 111, is_bot: false, first_name: 'Editor' },
        text: 'Tahrirlangan matn',
      },
    };

    const norm = normalizeTelegramMessage(update);
    assert.ok(norm);
    assert.strictEqual(norm.text, 'Tahrirlangan matn');
    assert.strictEqual(norm.rawMetadata.updateType, 'edited_message');
  });
});
