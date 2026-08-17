import { describe, it } from 'node:test';
import assert from 'node:assert';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import { runMigrations } from '../../packages/database/dist/index.js';
import { PgHandoffRepository } from '../../packages/database/dist/repositories/pg/handoff.repository.js';
import { PgConversationRepository } from '../../packages/database/dist/repositories/pg/conversation.repository.js';
import { PgCustomerRepository } from '../../packages/database/dist/repositories/pg/customer.repository.js';
import { PgContactRepository } from '../../packages/database/dist/repositories/pg/contact.repository.js';
import { PgMessageRepository } from '../../packages/database/dist/repositories/pg/message.repository.js';

// Safety Guard: Require ONLY LIMAX_TEST_DATABASE_URL (No DATABASE_URL fallback permitted)
const TEST_DB_URL = process.env.LIMAX_TEST_DATABASE_URL || '';

describe('Stage 10.1: PostgreSQL Handoff Delivery Persistence Integration Tests', () => {
  it('Real PostgreSQL Schema Alignment, Migration 001-007, and Concurrency Test Suite', async (t) => {
    // 1. LIMAX_TEST_DATABASE_URL check
    if (!TEST_DB_URL) {
      console.log('\n[Stage 10.1 PostgreSQL Test] NOT RUN (LIMAX_TEST_DATABASE_URL is not set)\n');
      t.skip('LIMAX_TEST_DATABASE_URL environment variable is missing');
      return;
    }

    // 2. Strict URL Safety Verification
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(TEST_DB_URL);
    } catch {
      assert.fail('LIMAX_TEST_DATABASE_URL is not a valid URL');
    }

    const protocol = parsedUrl.protocol;
    if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
      assert.fail(`Invalid database protocol "${protocol}". Must be postgresql: or postgres:`);
    }

    const host = parsedUrl.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
      assert.fail(`Remote host "${host}" rejected by safety rule. Must be 127.0.0.1 or localhost.`);
    }

    const dbName = parsedUrl.pathname.replace('/', '');
    const isTestDb = dbName === 'limax_test' || dbName.startsWith('limax_test_');

    if (!isTestDb) {
      assert.fail(`Database name "${dbName}" rejected. Must be limax_test or start with limax_test_ to protect production/dev databases.`);
    }

    // 3. Check PostgreSQL connection & ensure database exists
    const adminUrl = `${parsedUrl.protocol}//${parsedUrl.username}:${parsedUrl.password}@${parsedUrl.hostname}:${parsedUrl.port || '5432'}/postgres`;
    let isPgAvailable = false;
    try {
      const adminPool = new pg.Pool({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
      const checkRes = await adminPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
      if (checkRes.rows.length === 0) {
        await adminPool.query(`CREATE DATABASE "${dbName}"`);
      }
      await adminPool.end();
      isPgAvailable = true;
    } catch {
      isPgAvailable = false;
    }

    const pool = new pg.Pool({ connectionString: TEST_DB_URL });

    if (!isPgAvailable) {
      console.log(`\n[Stage 10.1 PostgreSQL Test] NOT RUN (No local PostgreSQL database connection available on localhost:5432 / ${dbName})\n`);
      t.skip('Local PostgreSQL database not available');
      await pool.end();
      return;
    }

    try {
      // 4. Run migrations 001-007 on clean PostgreSQL test DB
      await runMigrations(pool);

      // Verify _migrations ledger contains 7 migrations
      const migrationRes = await pool.query<{ name: string }>(
        'SELECT name FROM _migrations ORDER BY id ASC'
      );
      assert.ok(migrationRes.rows.length >= 7, '_migrations ledger must contain at least 7 migrations');
      assert.ok(migrationRes.rows.some(r => r.name.includes('007_handoff_schema_alignment')), '007_handoff_schema_alignment migration must be recorded');

      // Setup Repositories
      const pgHandoffRepo1 = new PgHandoffRepository(pool);
      const pgHandoffRepo2 = new PgHandoffRepository(pool); // Second instance for concurrency testing
      const pgCustomerRepo = new PgCustomerRepository(pool);
      const pgContactRepo = new PgContactRepository(pool);
      const pgConvRepo = new PgConversationRepository(pool);
      const pgMsgRepo = new PgMessageRepository(pool);

      // Setup Test Customer, Contact, Conversation
      const customer = await pgCustomerRepo.create({
        name: 'Ali Test User',
        preferredLanguage: 'uz',
        status: 'active',
        tags: ['test'],
      });
      const contact = await pgContactRepo.create({
        customerId: customer.id,
        channel: 'telegram',
        externalId: `pg_stage10_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        isPrimary: true,
      });
      const conv = await pgConvRepo.create({
        customerId: customer.id,
        contactId: contact.id,
        status: 'AI_ACTIVE',
        channel: 'telegram',
        lastMessageAt: new Date(),
      });

      // 5. Test status, notes, metadata INSERT via create()
      const initialMeta = { managerNotificationStatus: 'PENDING', batchId: 'b_101' };
      const handoff = await pgHandoffRepo1.create({
        conversationId: conv.id,
        customerId: customer.id,
        reason: 'CUSTOMER_REQUESTED_MANAGER',
        priority: 'high',
        status: 'PENDING',
        notes: 'Initial test note',
        metadata: initialMeta,
      });
      assert.ok(handoff.id, 'Handoff must have generated UUID');
      assert.strictEqual(handoff.status, 'PENDING');
      assert.strictEqual(handoff.notes, 'Initial test note');
      assert.deepStrictEqual(handoff.metadata, initialMeta);

      // 6. Test SELECT via findById & findByConversationId
      const foundById = await pgHandoffRepo1.findById(handoff.id);
      assert.ok(foundById);
      assert.strictEqual(foundById.status, 'PENDING');
      assert.strictEqual(foundById.notes, 'Initial test note');
      assert.strictEqual(foundById.metadata?.managerNotificationStatus, 'PENDING');

      const foundByConv = await pgHandoffRepo1.findByConversationId(conv.id);
      assert.ok(foundByConv.length >= 1);
      assert.strictEqual(foundByConv[0].status, 'PENDING');

      // 7. Test status, notes, metadata UPDATE
      const updatedHandoff = await pgHandoffRepo1.update(handoff.id, {
        notes: 'Updated manager note',
        metadata: { ...initialMeta, deliveryRetry: 1 },
      });
      assert.ok(updatedHandoff);
      assert.strictEqual(updatedHandoff.notes, 'Updated manager note');
      assert.strictEqual((updatedHandoff.metadata as any)?.deliveryRetry, 1);

      // 8. Test Partial Unique Index: Duplicate PENDING handoff for same conversation must be rejected
      let duplicateError: any = null;
      try {
        await pgHandoffRepo1.create({
          conversationId: conv.id,
          customerId: customer.id,
          reason: 'SECOND_PENDING_REQUEST',
          priority: 'medium',
          status: 'PENDING',
        });
      } catch (err: any) {
        duplicateError = err;
      }
      assert.ok(duplicateError, 'PostgreSQL must reject second PENDING handoff for same conversation');
      assert.strictEqual(duplicateError.code, '23505', 'Error code must be unique_violation (23505)');

      // 9. Test Parallel Manager Notification Claim Concurrency between two separate PgHandoffRepository instances
      await pgHandoffRepo1.update(handoff.id, {
        metadata: { managerNotificationStatus: 'PENDING' },
      });

      const [claim1, claim2] = await Promise.all([
        pgHandoffRepo1.claimManagerNotificationDelivery(handoff.id),
        pgHandoffRepo2.claimManagerNotificationDelivery(handoff.id),
      ]);

      const claimsCount = [claim1, claim2].filter(Boolean).length;
      assert.strictEqual(claimsCount, 1, 'Exactly one Pg repository instance must win manager notification claim');

      // 10. Verify SENT status cannot be claimed
      await pgHandoffRepo1.update(handoff.id, {
        metadata: { managerNotificationStatus: 'SENT', managerNotificationSentAt: new Date().toISOString() },
      });

      const sentClaimAttempt = await pgHandoffRepo1.claimManagerNotificationDelivery(handoff.id);
      assert.strictEqual(sentClaimAttempt, false, 'SENT notification status cannot be re-claimed');

      // 11. Verify FAILED status CAN be re-claimed for retry
      await pgHandoffRepo1.update(handoff.id, {
        metadata: { managerNotificationStatus: 'FAILED', managerNotificationError: 'Network Error' },
      });

      const failedClaimAttempt = await pgHandoffRepo1.claimManagerNotificationDelivery(handoff.id);
      assert.strictEqual(failedClaimAttempt, true, 'FAILED notification status MUST be re-claimed on retry');

      // 12. Stale PROCESSING recovery: verify >30s stale PROCESSING can be claimed
      await pgHandoffRepo1.update(handoff.id, {
        metadata: {
          managerNotificationStatus: 'PROCESSING',
          managerNotificationClaimedAt: new Date(Date.now() - 40000).toISOString(),
        },
      });

      const staleClaimAttempt = await pgHandoffRepo1.claimManagerNotificationDelivery(handoff.id, 30000);
      assert.strictEqual(staleClaimAttempt, true, 'Stale PROCESSING notification status MUST be recovered');

      // 13. Restart Persistence: verify SENT state survives process restart
      await pgHandoffRepo1.update(handoff.id, {
        metadata: { managerNotificationStatus: 'SENT', managerNotificationSentAt: new Date().toISOString() },
      });

      const freshRepoAfterRestart = new PgHandoffRepository(pool);
      const reloadedHandoff = await freshRepoAfterRestart.findById(handoff.id);
      assert.ok(reloadedHandoff);
      assert.strictEqual(reloadedHandoff.metadata?.managerNotificationStatus, 'SENT');

      // 14. Verify telegram_update_receipts.update_id is strictly BIGINT
      const testUpdateId = Date.now() + 9000000000;
      const receiptRes = await pool.query(
        'INSERT INTO telegram_update_receipts (update_id, update_type, status) VALUES ($1, $2, $3) RETURNING update_id',
        [testUpdateId, 'test_receipt_stage10', 'PROCESSED']
      );
      assert.strictEqual(Number(receiptRes.rows[0].update_id), testUpdateId);

      // 15. UTF-8 Clean Round-Trip Preservation (uz-Latn, uz-Cyrl, ru)
      const utf8Latn = 'Murojaatingiz menejerlarimizga yuborildi. Tez orada siz bilan bog‘lanamiz.';
      const utf8Cyrl = 'Мурожаатингиз менежерларимизга юборилди. Тез орада сиз bilan боғланамиз.';
      const utf8Ru = 'Ваше обращение передано нашим менеджерам. Мы скоро свяжемся с вами.';

      const msgLatn = await pgMsgRepo.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: utf8Latn,
        contentType: 'text',
        status: 'SENT',
        metadata: { messageKind: 'handoff_ack', handoffId: handoff.id },
      });
      assert.strictEqual(msgLatn.content, utf8Latn);
      assert.ok(!msgLatn.content.includes('bog\u00e2\u20ac\u2018lanamiz'), 'uz-Latn text must not contain mojibake');

      const msgCyrl = await pgMsgRepo.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: utf8Cyrl,
        contentType: 'text',
        status: 'SENT',
        metadata: { messageKind: 'handoff_ack', handoffId: handoff.id },
      });
      assert.strictEqual(msgCyrl.content, utf8Cyrl);

      const msgRu = await pgMsgRepo.create({
        conversationId: conv.id,
        senderType: 'ai',
        content: utf8Ru,
        contentType: 'text',
        status: 'SENT',
        metadata: { messageKind: 'handoff_ack', handoffId: handoff.id },
      });
      assert.strictEqual(msgRu.content, utf8Ru);

      // 16. Clean up test data after execution
      await pool.query('DELETE FROM customers WHERE id = $1', [customer.id]);

      console.log('\n✅ All Stage 10.1 PostgreSQL Integration & Concurrency Tests Passed Successfully!\n');
    } finally {
      await pool.end();
    }
  });
});
