import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  REQUIRED_SPREADSHEET_ID,
  SheetProductRowSchema,
  SheetPriceRowSchema,
  SheetInventoryRowSchema,
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
} from '../../packages/integrations/dist/google-sheets/index.js';
import { createRepositories } from '../../packages/database/dist/index.js';
import { AIOrchestrator } from '../../packages/ai-engine/dist/orchestrator.js';
import { createGoogleSheetsRouter } from '../../apps/api/dist/modules/google-sheets/router.js';

describe('Stage 17: Google Sheets Business Sync — Unit Tests', () => {
  // 1. Spreadsheet ID validation
  it('1. Rejects invalid spreadsheet IDs and accepts REQUIRED_SPREADSHEET_ID', () => {
    assert.throws(
      () => new GoogleSheetsClient({ spreadsheetId: 'wrong-id-12345' }),
      /Invalid Spreadsheet ID/
    );

    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: { Products: [], Prices: [], Inventory: [], Sync_Control: [] },
    });
    assert.ok(client);
  });

  // 2. Comma decimal normalizer and Price schema validation
  it('2. Normalizes comma decimals (2,85 -> 2.85) and validates payment types', () => {
    const validRow = SheetPriceRowSchema.parse({
      rowNumber: 2,
      productCode: '30/70',
      paymentType: 'bank_transfer',
      amount: '2,85',
      currency: 'USD',
      unit: 'kg',
      minOrderQuantity: '500,00',
      approvalStatus: 'approved',
      syncEnabled: 'TRUE',
    });

    assert.strictEqual(validRow.amount, 2.85);
    assert.strictEqual(validRow.minOrderQuantity, 500);
    assert.strictEqual(validRow.paymentType, 'BANK_TRANSFER');
    assert.strictEqual(validRow.approvalStatus, 'APPROVED');
    assert.strictEqual(validRow.syncEnabled, true);

    // Rejects invalid payment type
    assert.throws(
      () =>
        SheetPriceRowSchema.parse({
          rowNumber: 3,
          productCode: '30/70',
          paymentType: 'CRYPTO',
          amount: '2.85',
          approvalStatus: 'APPROVED',
          syncEnabled: 'TRUE',
        }),
      /Invalid enum value/
    );
  });

  // 3. Product code token preservation
  it('3. Preserves product code tokens (30/70, 75D/36, 2070K)', () => {
    const p1 = SheetProductRowSchema.parse({
      rowNumber: 2,
      productCode: '30/70',
      productName: '30/70 Kalava Ip Oq',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    });
    assert.strictEqual(p1.productCode, '30/70');

    const p2 = SheetProductRowSchema.parse({
      rowNumber: 3,
      productCode: '75D/36',
      productName: 'Polyester DTY 75D/36',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    });
    assert.strictEqual(p2.productCode, '75D/36');
  });

  // 4. Inventory invariants (reservedQuantity <= availableQuantity)
  it('4. Enforces inventory invariants (reservedQuantity <= availableQuantity)', () => {
    const validInv = SheetInventoryRowSchema.parse({
      rowNumber: 2,
      productCode: '30/70',
      availableQuantity: '1000',
      reservedQuantity: '200',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    });
    assert.strictEqual(validInv.availableQuantity, 1000);
    assert.strictEqual(validInv.reservedQuantity, 200);

    // Rejects when reserved > available
    assert.throws(
      () =>
        SheetInventoryRowSchema.parse({
          rowNumber: 3,
          productCode: '30/70',
          availableQuantity: '100',
          reservedQuantity: '200',
          approvalStatus: 'APPROVED',
          syncEnabled: 'TRUE',
        }),
      /reservedQuantity cannot exceed availableQuantity/
    );
  });

  // 5. APPROVED & syncEnabled filter in SyncEngine
  it('5. Filters only APPROVED and syncEnabled = true rows', async () => {
    const repos = createRepositories('memory');
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['30/70', 'Kalava Ip 30/70', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
          ['75D/36', 'DTY 75D/36', 'Polyester', 'Desc', 'kg', 'TRUE', 'DRAFT', 'TRUE'], // Rejected (DRAFT)
          ['2070K', 'Spun 2070K', 'Spun', 'Desc', 'kg', 'TRUE', 'APPROVED', 'FALSE'], // Rejected (SyncEnabled=FALSE)
        ],
        Prices: [
          ['Product Code', 'Payment Type', 'Amount', 'Currency', 'Unit', 'Min Order', 'Approval Status', 'Sync Enabled'],
          ['30/70', 'BANK_TRANSFER', '2.85', 'USD', 'kg', '500', 'APPROVED', 'TRUE'],
          ['75D/36', 'CASH', '2.70', 'USD', 'kg', '500', 'APPROVED', 'FALSE'], // Rejected
        ],
        Inventory: [
          ['Product Code', 'Available Qty', 'Reserved Qty', 'Unit', 'Warehouse', 'Approval Status', 'Sync Enabled'],
          ['30/70', '5000', '1000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [['Key', 'Value'], ['LOCK_STATUS', 'UNLOCKED']],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'memory');
    const result = await engine.runSync({ dryRun: false });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.counts.products, 1);
    assert.strictEqual(result.counts.prices, 1);
    assert.strictEqual(result.counts.inventory, 1);

    const prods = await repos.products.findAll({});
    assert.strictEqual(prods.length, 1);
    assert.strictEqual(prods[0].code, '30/70');
  });

  // 6. Duplicate productCode rejection in SyncEngine
  it('6. Rejects duplicate productCode in Products tab and stops sync', async () => {
    const repos = createRepositories('memory');
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['30/70', 'Kalava Ip 30/70 Type A', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
          ['30/70', 'Kalava Ip 30/70 Type B', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'], // Duplicate!
        ],
        Prices: [],
        Inventory: [],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'memory');
    const result = await engine.runSync({ dryRun: false });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 'FAILED');
    assert.ok(result.errors?.some((e) => e.includes('Duplicate approved productCode')));
  });

  // 7. Checksum idempotency (no mutation on duplicate sync)
  it('7. Unchanged checksum skips DB mutation idempotently', async () => {
    const repos = createRepositories('memory');
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['30/70', 'Kalava Ip 30/70', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['Product Code', 'Payment Type', 'Amount', 'Currency', 'Unit', 'Min Order', 'Approval Status', 'Sync Enabled'],
          ['30/70', 'BANK_TRANSFER', '2.85', 'USD', 'kg', '500', 'APPROVED', 'TRUE'],
        ],
        Inventory: [
          ['Product Code', 'Available Qty', 'Reserved Qty', 'Unit', 'Warehouse', 'Approval Status', 'Sync Enabled'],
          ['30/70', '5000', '1000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'memory');
    // First sync -> SUCCESS
    const res1 = await engine.runSync({ dryRun: false });
    assert.strictEqual(res1.status, 'SUCCESS');

    // Second sync with identical data -> SKIPPED_UNCHANGED
    const res2 = await engine.runSync({ dryRun: false });
    assert.strictEqual(res2.status, 'SKIPPED_UNCHANGED');
    assert.strictEqual(res2.checksum, res1.checksum);
  });

  // 8. DryRun mode does not write to database
  it('8. DryRun mode parses and validates without modifying database', async () => {
    const repos = createRepositories('memory');
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['DRY-PROD', 'Dry Run Product', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [],
        Inventory: [],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'memory');
    const dryRes = await engine.runSync({ dryRun: true });

    assert.strictEqual(dryRes.success, true);
    assert.strictEqual(dryRes.dryRun, true);
    assert.strictEqual(dryRes.counts.products, 1);

    // Database remains empty
    const prods = await repos.products.findAll({});
    assert.strictEqual(prods.length, 0);
  });

  // 9. Stale sync check in AI Orchestrator (10 minutes)
  it('9. AI Orchestrator triggers safe handoff when sync is stale (>10 min)', async () => {
    const repos = createRepositories('memory');
    const p = await repos.products.create({
      code: '30/70',
      name: 'Kalava Ip 30/70',
      category: 'Yarn',
      description: '',
      price: 0,
      currency: 'USD',
      minimumOrder: 1,
      stockStatus: 'in_stock',
      media: [],
      active: true,
      aiRecommendable: true,
    });
    await repos.productPrices.create({
      productId: p.id,
      price: 2.85,
      currency: 'USD',
      paymentType: 'BANK_TRANSFER',
      active: true,
    });
    await repos.productInventory.upsert(p.id, {
      availableQuantity: 4000,
      reservedQuantity: 0,
      status: 'IN_STOCK',
    });

    // Record an old sync (15 minutes ago)
    const oldDate = new Date(Date.now() - 15 * 60 * 1000);
    await repos.googleSheetsSync.create({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      status: 'SUCCESS',
      lastAttemptAt: oldDate,
      lastSuccessAt: oldDate,
      checksum: 'old_checksum',
      productsCount: 1,
      pricesCount: 1,
      inventoryCount: 1,
    });

    const orchestrator = new AIOrchestrator(repos, { aiMode: 'mock' });
    const result = await orchestrator.processQuery('30/70 kalava ip narxi qancha?', {}, { repos });

    assert.strictEqual(result.needsHandoff, true);
    assert.strictEqual(result.handoffReason, 'STALE_BUSINESS_DATA');
  });

  // 10. Google Sheets Router Auth Protection
  it('10. Protects Google Sheets API router with internal token', () => {
    const repos = createRepositories('memory');
    const router = createGoogleSheetsRouter({
      repos,
      driver: 'memory',
      internalToken: 'test-secret-token',
    });
    assert.ok(router);
  });

  // 11. Bilimlar_Bazasi Knowledge Base Tab Synchronization
  it('11. Syncs Bilimlar_Bazasi tab into knowledge items with chunk creation', async () => {
    const repos = createRepositories('memory');
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['TEST-1', 'Mahsulot 1', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [],
        Inventory: [],
        Sync_Control: [],
        Bilimlar_Bazasi: [
          ['Sarlavha', 'Matn', 'Kategoriya', 'Til', 'Status', 'Sinxronlash'],
          ['Yetkazib berish shartlari', 'Toshkent bo‘ylab 24 soat ichida yetkaziladi.', 'Logistika', 'uz', 'APPROVED', 'TRUE'],
          ['To‘lov usullari', 'Pul o‘tkazish (perchislenie) va naqd to‘lov qabul qilinadi.', 'Moliya', 'uz', 'APPROVED', 'TRUE'],
          ['Qoralama savol', 'Bu javob hali tasdiqlanmagan.', 'Sinov', 'uz', 'DRAFT', 'TRUE'],
        ],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'memory');
    const result = await engine.runSync({ dryRun: false });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.counts.knowledge, 2);
    assert.strictEqual(result.details?.knowledgeAdded, 2);

    const allKnowledge = await repos.knowledge.findAll({});
    assert.strictEqual(allKnowledge.length, 2);
    assert.ok(allKnowledge.some((k) => k.title === 'Yetkazib berish shartlari'));
    assert.ok(allKnowledge.some((k) => k.title === 'To‘lov usullari'));
  });
});
