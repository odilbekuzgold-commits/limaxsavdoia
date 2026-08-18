import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import {
  runMigrations,
  createRepositories,
} from '../../packages/database/dist/index.js';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  REQUIRED_SPREADSHEET_ID,
} from '../../packages/integrations/dist/google-sheets/index.js';

describe('Stage 17: PostgreSQL Real Integration — Google Sheets Business Sync', () => {
  let pool: pg.Pool;
  const TEST_DB_URL = process.env.DATABASE_URL || 'postgresql://limax_user:LimaxManager1122@localhost:5432/limax_db';

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool);
    // Cleanup prior test artifacts
    await pool.query("DELETE FROM product_prices WHERE product_id IN (SELECT id FROM products WHERE code LIKE 'TEST-%')");
    await pool.query("DELETE FROM product_inventory WHERE product_id IN (SELECT id FROM products WHERE code LIKE 'TEST-%')");
    await pool.query("DELETE FROM products WHERE code LIKE 'TEST-%'");
    await pool.query("DELETE FROM google_sheets_sync_state");
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('1. Migration 014 applied cleanly and google_sheets_sync_state table exists', async () => {
    const tableRes = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'google_sheets_sync_state'"
    );
    assert.strictEqual(tableRes.rows.length, 1);

    const colRes = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'product_prices' AND column_name = 'payment_type'"
    );
    assert.strictEqual(colRes.rows.length, 1);
  });

  it('2. Atomic PostgreSQL sync creates products, prices (BANK_TRANSFER & CASH) and inventory', async () => {
    const repos = createRepositories('postgres', pool);
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['TEST-3070', 'Test Kalava Ip 30/70', 'Yarn', 'Polyester yarn', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['Product Code', 'Payment Type', 'Amount', 'Currency', 'Unit', 'Min Order', 'Approval Status', 'Sync Enabled'],
          ['TEST-3070', 'BANK_TRANSFER', '2.85', 'USD', 'kg', '500', 'APPROVED', 'TRUE'],
          ['TEST-3070', 'CASH', '2.75', 'USD', 'kg', '500', 'APPROVED', 'TRUE'],
        ],
        Inventory: [
          ['Product Code', 'Available Qty', 'Reserved Qty', 'Unit', 'Warehouse', 'Approval Status', 'Sync Enabled'],
          ['TEST-3070', '4500', '500', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [['Key', 'Value'], ['SYNC_ENABLED', 'TRUE']],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'postgres', pool);
    const res = await engine.runSync({ dryRun: false });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'SUCCESS');

    // Verify in PostgreSQL
    const prodRes = await pool.query("SELECT * FROM products WHERE code = 'TEST-3070'");
    assert.strictEqual(prodRes.rows.length, 1);
    const prodId = prodRes.rows[0].id;

    // Verify two active prices exist (BANK_TRANSFER and CASH)
    const pricesRes = await pool.query(
      "SELECT * FROM product_prices WHERE product_id = $1 AND active = true ORDER BY payment_type ASC",
      [prodId]
    );
    assert.strictEqual(pricesRes.rows.length, 2);
    assert.strictEqual(pricesRes.rows[0].payment_type, 'BANK_TRANSFER');
    assert.strictEqual(parseFloat(pricesRes.rows[0].price), 2.85);
    assert.strictEqual(pricesRes.rows[1].payment_type, 'CASH');
    assert.strictEqual(parseFloat(pricesRes.rows[1].price), 2.75);

    // Verify inventory
    const invRes = await pool.query("SELECT * FROM product_inventory WHERE product_id = $1", [prodId]);
    assert.strictEqual(invRes.rows.length, 1);
    assert.strictEqual(parseFloat(invRes.rows[0].available_quantity), 4500);
    assert.strictEqual(parseFloat(invRes.rows[0].reserved_quantity), 500);
  });

  it('3. Price versioning: price change deactivates old price and inserts new active price', async () => {
    const repos = createRepositories('postgres', pool);
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['TEST-3070', 'Test Kalava Ip 30/70', 'Yarn', 'Polyester yarn', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [
          ['Product Code', 'Payment Type', 'Amount', 'Currency', 'Unit', 'Min Order', 'Approval Status', 'Sync Enabled'],
          ['TEST-3070', 'BANK_TRANSFER', '2.95', 'USD', 'kg', '500', 'APPROVED', 'TRUE'], // Price updated to 2.95
          ['TEST-3070', 'CASH', '2.75', 'USD', 'kg', '500', 'APPROVED', 'TRUE'], // Unchanged
        ],
        Inventory: [
          ['Product Code', 'Available Qty', 'Reserved Qty', 'Unit', 'Warehouse', 'Approval Status', 'Sync Enabled'],
          ['TEST-3070', '4500', '500', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'],
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'postgres', pool);
    const res = await engine.runSync({ dryRun: false });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.details?.pricesCreated, 1);
    assert.strictEqual(res.details?.pricesUnchanged, 1);

    const prodRes = await pool.query("SELECT id FROM products WHERE code = 'TEST-3070'");
    const prodId = prodRes.rows[0].id;

    // Total prices for BANK_TRANSFER should now be 2 (1 inactive old price 2.85, 1 active new price 2.95)
    const btPricesRes = await pool.query(
      "SELECT price, active, valid_until FROM product_prices WHERE product_id = $1 AND payment_type = 'BANK_TRANSFER' ORDER BY created_at ASC",
      [prodId]
    );
    assert.strictEqual(btPricesRes.rows.length, 2);
    assert.strictEqual(parseFloat(btPricesRes.rows[0].price), 2.85);
    assert.strictEqual(btPricesRes.rows[0].active, false);
    assert.ok(btPricesRes.rows[0].valid_until !== null);

    assert.strictEqual(parseFloat(btPricesRes.rows[1].price), 2.95);
    assert.strictEqual(btPricesRes.rows[1].active, true);
  });

  it('4. Atomic transaction rollback on invalid row preserves previous DB state', async () => {
    const repos = createRepositories('postgres', pool);
    const mockClient = new GoogleSheetsClient({
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      mockData: {
        Products: [
          ['Product Code', 'Product Name', 'Category', 'Description', 'Unit', 'Active', 'Approval Status', 'Sync Enabled'],
          ['BAD-ROW-PROD', 'Corrupted Product', 'Yarn', 'Desc', 'kg', 'TRUE', 'APPROVED', 'TRUE'],
        ],
        Prices: [],
        Inventory: [
          ['Product Code', 'Available Qty', 'Reserved Qty', 'Unit', 'Warehouse', 'Approval Status', 'Sync Enabled'],
          ['BAD-ROW-PROD', '100', '500', 'kg', 'Toshkent Bosh Ombor', 'APPROVED', 'TRUE'], // Invalid! (reserved > available)
        ],
        Sync_Control: [],
      },
    });

    const engine = new GoogleSheetsSyncEngine(mockClient, repos, 'postgres', pool);
    const res = await engine.runSync({ dryRun: false });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'FAILED');

    // Product BAD-ROW-PROD must NOT exist in DB due to atomic rollback
    const checkProd = await pool.query("SELECT * FROM products WHERE code = 'BAD-ROW-PROD'");
    assert.strictEqual(checkProd.rows.length, 0);

    // Sync state must have recorded the failure
    const stateRes = await pool.query("SELECT * FROM google_sheets_sync_state ORDER BY last_attempt_at DESC LIMIT 1");
    assert.strictEqual(stateRes.rows[0].status, 'FAILED');
    assert.ok(stateRes.rows[0].sanitized_error?.includes('reservedQuantity cannot exceed availableQuantity'));
  });
});
