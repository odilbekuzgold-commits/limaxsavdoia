import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  SheetProductRowSchema,
  SheetPriceRowSchema,
  SheetInventoryRowSchema,
  REQUIRED_SPREADSHEET_ID,
} from '../../packages/integrations/dist/index.js';
import { createRepositories } from '../../packages/database/dist/index.js';

describe('Stage 17.1: Google Sheets Source Fidelity & Safety Unit Tests', () => {
  it('1. Source Fidelity: 40100K, MIC COLOR, Poliester, 30/70, 75D/36 tokens preserved exactly', () => {
    const rawRow = {
      rowNumber: 2,
      productCode: '40100K',
      productName: 'MIC COLOR Poliester 30/70 75D/36',
      category: 'Yarn',
      color: '',
      yarnType: 'Poliester',
      count: '30/70',
      composition: '30% Paxta, 70% Poliester',
      description: 'Mexanicheskiy va Vozdushniy kalava ip',
      unit: 'kg',
      active: 'TRUE',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    };

    const parsed = SheetProductRowSchema.parse(rawRow);
    assert.strictEqual(parsed.productCode, '40100K', 'productCode must strictly preserve 40100K');
    assert.strictEqual(parsed.productName, 'MIC COLOR Poliester 30/70 75D/36', 'productName must strictly preserve MIC COLOR and tokens');
    assert.strictEqual(parsed.yarnType, 'Poliester', 'yarnType must strictly preserve Poliester');
    assert.strictEqual(parsed.count, '30/70', 'count must strictly preserve 30/70');
    assert.strictEqual(parsed.color, '', 'Empty color must strictly remain blank');
    assert.strictEqual(parsed.description, 'Mexanicheskiy va Vozdushniy kalava ip', 'Description must not be translated');
  });

  it('2. Source Fidelity: Blank color remains blank and is not auto-filled with dummy defaults', () => {
    const rawRow = {
      rowNumber: 3,
      productCode: '2070K_RAW',
      productName: '2070K Kalava Ip',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    };

    const parsed = SheetProductRowSchema.parse(rawRow);
    assert.strictEqual(parsed.color, '', 'Color must default to empty string without hallucinated color');
    assert.strictEqual(parsed.unit, 'kg', 'Unit must default to kg');
  });

  it('3. Currency & Unit validation: USD currency and kg units are strictly enforced', () => {
    const validPrice = SheetPriceRowSchema.parse({
      rowNumber: 2,
      productCode: '40100K',
      paymentType: 'BANK_TRANSFER',
      amount: '2,85',
      currency: 'USD',
      unit: 'kg',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    });
    assert.strictEqual(validPrice.amount, 2.85, 'Comma decimal 2,85 must be parsed to numeric 2.85');
    assert.strictEqual(validPrice.currency, 'USD');
    assert.strictEqual(validPrice.unit, 'kg');
  });

  it('4. Inventory Nullable: Missing or UNKNOWN quantity is null and not falsified to 0', () => {
    const rawInvUnknown = SheetInventoryRowSchema.parse({
      rowNumber: 2,
      productCode: '40100K',
      availableQuantity: 'UNKNOWN',
      reservedQuantity: '',
      unit: 'kg',
      approvalStatus: 'APPROVED',
      syncEnabled: 'TRUE',
    });
    assert.strictEqual(rawInvUnknown.availableQuantity, null, 'UNKNOWN availableQuantity must parse as null');
    assert.strictEqual(rawInvUnknown.reservedQuantity, 0, 'Blank reservedQuantity defaults to 0');
  });

  it('5. Filtering: approvalStatus != APPROVED and syncEnabled != TRUE are skipped with count tracking', async () => {
    const repos = createRepositories('memory');
    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['productCode', 'productName', 'category', 'color', 'yarnType', 'count', 'composition', 'description', 'unit', 'active', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'MIC COLOR 40100K', 'Yarn', '', 'Poliester', '40/100', '', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
          ['PENDING_1', 'Pending Item', 'Yarn', '', 'Cotton', '30/1', '', 'Desc', 'kg', 'TRUE', 'PENDING', 'TRUE'],
          ['DISABLED_1', 'Disabled Item', 'Yarn', '', 'Cotton', '20/1', '', 'Desc', 'kg', 'TRUE', 'APPROVED', 'FALSE'],
        ],
        Prices: [
          ['productCode', 'paymentType', 'amount', 'currency', 'unit', 'minOrderQuantity', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'BANK_TRANSFER', '2.95', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
          ['PENDING_1', 'BANK_TRANSFER', '2.50', 'USD', 'kg', '1', 'PENDING', 'TRUE'],
        ],
        Inventory: [
          ['productCode', 'availableQuantity', 'reservedQuantity', 'unit', 'warehouse', 'approvalStatus', 'syncEnabled'],
          ['40100K', '5000', '1000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
          ['PENDING_1', '2000', '0', 'kg', 'Toshkent Bosh Ombor', 'PENDING', 'TRUE'],
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(client, repos, 'memory');
    const result = await engine.runSync({ dryRun: true });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.counts.products, 1, 'Only 1 approved & enabled product should be counted');
    assert.strictEqual(result.details?.skippedPending, 3, '3 rows were pending approval');
    assert.strictEqual(result.details?.skippedDisabled, 1, '1 row had syncEnabled=FALSE');
  });

  it('6. Dry-Run Safety: dryRun = true produces 0 mutations in repository', async () => {
    const repos = createRepositories('memory');
    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['productCode', 'productName', 'category', 'color', 'yarnType', 'count', 'composition', 'description', 'unit', 'active', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'MIC COLOR 40100K', 'Yarn', '', 'Poliester', '40/100', '', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['productCode', 'paymentType', 'amount', 'currency', 'unit', 'minOrderQuantity', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'BANK_TRANSFER', '2.95', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
        ],
        Inventory: [
          ['productCode', 'availableQuantity', 'reservedQuantity', 'unit', 'warehouse', 'approvalStatus', 'syncEnabled'],
          ['40100K', '5000', '1000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(client, repos, 'memory');
    const result = await engine.runSync({ dryRun: true });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dryRun, true);

    const prods = await repos.products.findAll({});
    assert.strictEqual(prods.length, 0, 'Zero products must be written to DB during dry-run');
  });

  it('7. Apply & Checksum Idempotency: second apply with identical data returns SKIPPED_UNCHANGED', async () => {
    const repos = createRepositories('memory');
    const client = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['productCode', 'productName', 'category', 'color', 'yarnType', 'count', 'composition', 'description', 'unit', 'active', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'MIC COLOR 40100K', 'Yarn', '', 'Poliester', '40/100', '', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['productCode', 'paymentType', 'amount', 'currency', 'unit', 'minOrderQuantity', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'BANK_TRANSFER', '2.95', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
          ['40100K', 'CASH', '2.85', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
        ],
        Inventory: [
          ['productCode', 'availableQuantity', 'reservedQuantity', 'unit', 'warehouse', 'approvalStatus', 'syncEnabled'],
          ['40100K', '5000', '1000', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(client, repos, 'memory');
    const res1 = await engine.runSync({ dryRun: false });
    assert.strictEqual(res1.status, 'SUCCESS');

    const res2 = await engine.runSync({ dryRun: false });
    assert.strictEqual(res2.status, 'SKIPPED_UNCHANGED', 'Second run with same checksum must be SKIPPED_UNCHANGED');
  });

  it('8. Price Versioning: updated price deactivates previous active price and creates new active price', async () => {
    const repos = createRepositories('memory');
    const client1 = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['productCode', 'productName', 'category', 'color', 'yarnType', 'count', 'composition', 'description', 'unit', 'active', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'MIC COLOR 40100K', 'Yarn', '', 'Poliester', '40/100', '', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['productCode', 'paymentType', 'amount', 'currency', 'unit', 'minOrderQuantity', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'BANK_TRANSFER', '2.95', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
        ],
        Inventory: [],
        Sync_Control: [],
      },
    });

    const engine1 = new GoogleSheetsSyncEngine(client1, repos, 'memory');
    await engine1.runSync({ dryRun: false });

    // New price in sheet: 3.10 USD
    const client2 = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['productCode', 'productName', 'category', 'color', 'yarnType', 'count', 'composition', 'description', 'unit', 'active', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'MIC COLOR 40100K', 'Yarn', '', 'Poliester', '40/100', '', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['productCode', 'paymentType', 'amount', 'currency', 'unit', 'minOrderQuantity', 'approvalStatus', 'syncEnabled'],
          ['40100K', 'BANK_TRANSFER', '3.10', 'USD', 'kg', '1', 'APPROVED', 'TRUE'],
        ],
        Inventory: [],
        Sync_Control: [],
      },
    });

    const engine2 = new GoogleSheetsSyncEngine(client2, repos, 'memory');
    const res2 = await engine2.runSync({ dryRun: false });
    assert.strictEqual(res2.status, 'SUCCESS');
    assert.strictEqual(res2.details?.pricesCreated, 1);

    const prods = await repos.products.findAll({});
    const prices = await repos.productPrices.findByProductId(prods[0].id);
    assert.strictEqual(prices.length, 2, 'History of both prices must be preserved in repository');
    const activePrice = prices.find((p) => p.active);
    const inactivePrice = prices.find((p) => !p.active);
    assert.strictEqual(activePrice?.price, 3.10);
    assert.strictEqual(inactivePrice?.price, 2.95);
  });
});
