import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from '../../packages/database/node_modules/pg/lib/index.js';
import {
  getDbPool,
  closeDbPool,
  runMigrations,
  createRepositories,
  withTransaction,
  type Repositories,
} from '../../packages/database/dist/index.js';
import { createProductPrice } from '../../apps/api/dist/modules/pricing.js';
import { updateProductInventory } from '../../apps/api/dist/modules/inventory.js';

const { Pool } = pg;

// Safety Guard: Require ONLY LIMAX_TEST_DATABASE_URL (No DATABASE_URL fallback permitted)
const TEST_DB_URL = process.env.LIMAX_TEST_DATABASE_URL || '';

describe('Stage 14.2: Real PostgreSQL Business Data CRUD, Invariants & Safety Integration Tests', () => {
  let pool: pg.Pool;
  let testDbName: string;
  let repos: Repositories;
  let testDbUrl: string;

  before(async () => {
    if (!TEST_DB_URL) {
      console.log('\n[Stage 14.2 PostgreSQL Test] SKIPPED / NOT RUN (LIMAX_TEST_DATABASE_URL is not set)\n');
      return;
    }

    if (!TEST_DB_URL.startsWith('postgres:') && !TEST_DB_URL.startsWith('postgresql:')) {
      throw new Error('LIMAX_TEST_DATABASE_URL must be a valid postgresql connection URL');
    }

    const parsed = new URL(TEST_DB_URL);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error('Integration tests are restricted to local test databases (127.0.0.1 or localhost)');
    }

    const baseDbName = parsed.pathname.slice(1);
    if (!baseDbName.startsWith('limax_test')) {
      throw new Error('LIMAX_TEST_DATABASE_URL database name must start with limax_test or limax_test_');
    }

    testDbName = `limax_test_stage14_2_${Date.now()}`;
    const adminUrl = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/postgres`;
    const adminPool = new Pool({ connectionString: adminUrl });
    await adminPool.query(`CREATE DATABASE "${testDbName}"`);
    await adminPool.end();

    testDbUrl = `postgresql://${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/${testDbName}`;
    process.env.DATABASE_URL = testDbUrl;

    pool = getDbPool(testDbUrl);
    await runMigrations(pool);
    repos = createRepositories('postgres', pool);
  });

  after(async () => {
    if (pool) {
      await closeDbPool();
    }
    if (testDbName && TEST_DB_URL) {
      const parsed = new URL(TEST_DB_URL);
      const adminUrl = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/postgres`;
      const adminPool = new Pool({ connectionString: adminUrl });
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await adminPool.end();
    }
  });

  it('1. Migrations 001-013 applied cleanly and ledger contains exactly 13 migrations', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const migrationRes = await pool.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY id ASC'
    );
    assert.strictEqual(migrationRes.rows.length, 13, '_migrations ledger must contain exactly 13 migrations');
    assert.ok(migrationRes.rows.some((r) => r.name.includes('011_products_code_unique')), '011_products_code_unique migration must be recorded');
    assert.ok(migrationRes.rows.some((r) => r.name.includes('012_product_prices_single_active')), '012_product_prices_single_active migration must be recorded');
    assert.ok(migrationRes.rows.some((r) => r.name.includes('013_knowledge_runtime_rag_alignment')), '013_knowledge_runtime_rag_alignment migration must be recorded');

    // Test migration idempotency (second run succeeds)
    await runMigrations(pool);
    const recheckRes = await pool.query('SELECT name FROM _migrations ORDER BY id ASC');
    assert.strictEqual(recheckRes.rows.length, 13, 'Second migration run should be idempotent with 13 migrations');
  });

  it('2. Case-insensitive duplicate product code insertion rejected at DB level', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const code = 'TEST_STAGE14_2_P1';
    const prod1 = await repos.products.create({
      name: 'Yarn Product 1',
      code,
      category: 'Yarn',
      description: 'Yarn 1',
      price: 15.5,
      currency: 'USD',
    });
    assert.strictEqual(prod1.code, code);

    // Attempt second insert with different case and whitespace: '  test_stage14_2_p1  '
    await assert.rejects(
      async () => {
        const trimmedCode = '  test_stage14_2_p1  '.trim();
        await repos.products.create({
          name: 'Yarn Product 1 Duplicate',
          code: trimmedCode,
          category: 'Yarn',
          description: 'Yarn 1 Dup',
          price: 16.0,
          currency: 'USD',
        });
      },
      (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        return pgErr.code === '23505' || Boolean(pgErr.message?.includes('23505') || pgErr.message?.includes('uq_products_code_lower'));
      },
      'Case-insensitive duplicate code must trigger PG 23505 unique error'
    );
  });

  it('3. Parallel product insert with duplicate code: exactly one succeeds and row count changes by +1', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const initialRows = await repos.products.findAll({});
    const dupCode = 'PARALLEL_CODE_TEST';

    const p1 = repos.products.create({
      name: 'Parallel Prod A',
      code: dupCode,
      category: 'Yarn',
      description: 'A',
      price: 10,
    });

    const p2 = repos.products.create({
      name: 'Parallel Prod B',
      code: '  parallel_code_test  '.trim(),
      category: 'Yarn',
      description: 'B',
      price: 12,
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one parallel insert must succeed');
    assert.strictEqual(rejected.length, 1, 'Exactly one parallel insert must fail due to duplicate index');

    const finalRows = await repos.products.findAll({});
    assert.strictEqual(finalRows.length, initialRows.length + 1, 'Product count must increase by exactly 1');
  });

  it('4. Product mutation and audit log atomic commit', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const code = 'ATOMIC_PROD_001';
    await withTransaction('postgres', pool, repos, async (txRepos) => {
      const created = await txRepos.products.create({
        name: 'Atomic Product',
        code,
        category: 'Yarn',
        description: 'Atomic Test',
        price: 25.0,
      });

      await txRepos.auditLogs.create({
        userId: 'test-user',
        userRole: 'ADMIN',
        action: 'CREATE_PRODUCT',
        entityType: 'products',
        entityId: created.id,
        details: { code },
      });
    });

    const foundProds = await repos.products.findAll({});
    const createdProd = foundProds.find((p) => p.code === code);
    assert.ok(createdProd, 'Product must be committed');

    const auditRes = await repos.auditLogs.findAll({ entityId: createdProd.id });
    assert.strictEqual(auditRes.data.length, 1, 'Audit log must be committed alongside product');
  });

  it('5. Audit failure rolls back product creation in transaction', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const code = 'ROLLBACK_PROD_001';

    await assert.rejects(async () => {
      await withTransaction('postgres', pool, repos, async (txRepos) => {
        await txRepos.products.create({
          name: 'Rollback Product',
          code,
          category: 'Yarn',
          description: 'Rollback Test',
          price: 30.0,
        });

        // Intentionally throw error to force transaction rollback
        throw new Error('Simulated audit failure');
      });
    });

    const allProds = await repos.products.findAll({});
    const failedProd = allProds.find((p) => p.code === code);
    assert.strictEqual(failedProd, undefined, 'Product must be rolled back on audit failure');
  });

  it('6. Real createProductPrice() deactivates prior ACTIVE price and preserves history', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'Price Test Product',
      code: 'PRICE_PROD_001',
      category: 'Yarn',
      description: 'Pricing',
      price: 10,
    });

    // Create initial ACTIVE price via production service helper createProductPrice()
    const price1 = await createProductPrice(repos, {
      productId: prod.id,
      amount: 100.0,
      currency: 'USD',
      active: true,
    }, 'test-admin', 'ADMIN', 'postgres', pool);

    assert.strictEqual(price1.active, true);

    // Create second ACTIVE price via production service helper createProductPrice()
    const price2 = await createProductPrice(repos, {
      productId: prod.id,
      amount: 120.0,
      currency: 'USD',
      active: true,
    }, 'test-admin', 'ADMIN', 'postgres', pool);

    assert.strictEqual(price2.active, true);

    // Verify in PostgreSQL database that price1 is now INACTIVE (active=false) and price2 is ACTIVE
    const allPrices = await repos.productPrices.findByProductId(prod.id);
    assert.strictEqual(allPrices.length, 2, 'Price history must retain 2 price records');

    const activePrices = allPrices.filter((p) => p.active);
    assert.strictEqual(activePrices.length, 1, 'Exactly 1 active price must remain');
    assert.strictEqual(activePrices[0].id, price2.id, 'Latest created price must be the active price');

    const inactivePrices = allPrices.filter((p) => !p.active);
    assert.strictEqual(inactivePrices.length, 1, 'Previous price must be inactive');
    assert.strictEqual(inactivePrices[0].id, price1.id);
  });

  it('7. Concurrent createProductPrice() requests produce exactly 1 ACTIVE price in DB', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'Concurrent Price Product',
      code: 'CONCUR_PRICE_PROD',
      category: 'Yarn',
      description: 'Concur Pricing',
      price: 10,
    });

    const pool1 = getDbPool(testDbUrl);
    const pool2 = getDbPool(testDbUrl);
    const repos1 = createRepositories('postgres', pool1);
    const repos2 = createRepositories('postgres', pool2);

    const req1 = createProductPrice(repos1, {
      productId: prod.id,
      amount: 200.0,
      currency: 'USD',
      active: true,
    }, 'user1', 'ADMIN', 'postgres', pool1);

    const req2 = createProductPrice(repos2, {
      productId: prod.id,
      amount: 250.0,
      currency: 'USD',
      active: true,
    }, 'user2', 'ADMIN', 'postgres', pool2);

    await Promise.allSettled([req1, req2]);

    const finalPrices = await repos.productPrices.findByProductId(prod.id);
    const activePrices = finalPrices.filter((p) => p.active);

    assert.strictEqual(activePrices.length, 1, 'Database must contain exactly 1 ACTIVE price after concurrent price creations');
  });

  it('8. Partial unique index uq_product_prices_single_active rejects direct duplicate active price insert', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'Direct Index Product',
      code: 'DIRECT_INDEX_PROD',
      category: 'Yarn',
      description: 'Direct',
      price: 10,
    });

    await repos.productPrices.create({
      productId: prod.id,
      price: 50.0,
      currency: 'USD',
      active: true,
    });

    // Attempt direct SQL insert bypassing service advisory lock
    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO product_prices (product_id, price, currency, active, valid_from) VALUES ($1, $2, $3, true, NOW())`,
          [prod.id, 60.0, 'USD']
        );
      },
      (err: unknown) => {
        const pgErr = err as { code?: string; message?: string };
        return pgErr.code === '23505' || Boolean(pgErr.message?.includes('23505') || pgErr.message?.includes('uq_product_prices_single_active'));
      },
      'Direct duplicate active price insert must be blocked by DB partial unique index'
    );
  });

  it('9. Inventory zero quantity derives OUT_OF_STOCK status and updates correctly via service', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'Zero Stock Product',
      code: 'ZERO_STOCK_PROD',
      category: 'Yarn',
      description: 'Zero Stock',
      price: 10,
    });

    const updated = await updateProductInventory(repos, prod.id, {
      availableQuantity: 0,
      reservedQuantity: 0,
      unit: 'kg',
    }, 'admin', 'ADMIN', 'postgres', pool);

    assert.strictEqual(updated.status, 'OUT_OF_STOCK', 'Zero available stock must derive OUT_OF_STOCK status');
    assert.strictEqual(updated.availableQuantity, 0);
  });

  it('10. Inventory net-zero quantity (available == reserved) derives OUT_OF_STOCK status', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'Net Zero Product',
      code: 'NET_ZERO_PROD',
      category: 'Yarn',
      description: 'Net Zero',
      price: 10,
    });

    const updated = await updateProductInventory(repos, prod.id, {
      availableQuantity: 50,
      reservedQuantity: 50,
      unit: 'kg',
    }, 'admin', 'ADMIN', 'postgres', pool);

    assert.strictEqual(updated.status, 'OUT_OF_STOCK', 'Net-zero available stock (50 - 50 = 0) must derive OUT_OF_STOCK status');
  });

  it('11. Missing inventory query evaluates status to UNKNOWN / null', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const missingInv = await repos.productInventory.findByProductId('00000000-0000-0000-0000-000000000000');
    assert.strictEqual(missingInv, null, 'Missing inventory query must return null');
  });

  it('12. Omitting warehouse parameter leaves warehouse null without fake Main Warehouse default', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'No Warehouse Product',
      code: 'NO_WH_PROD',
      category: 'Yarn',
      description: 'No WH',
      price: 10,
    });

    const updated = await updateProductInventory(repos, prod.id, {
      availableQuantity: 100,
      reservedQuantity: 10,
      unit: 'kg',
    }, 'admin', 'ADMIN', 'postgres', pool);

    assert.strictEqual(updated.warehouse, undefined, 'Omitting warehouse parameter must not inject fake Main Warehouse default');
  });

  it('13. Concurrent inventory updates with stale version returns 409 conflict', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const prod = await repos.products.create({
      name: 'Version Conflict Product',
      code: 'VER_CONFLICT_PROD',
      category: 'Yarn',
      description: 'Conflict',
      price: 10,
    });

    const initialInv = await repos.productInventory.upsert(prod.id, {
      availableQuantity: 100,
      reservedQuantity: 0,
      unit: 'kg',
    });

    const initialVersion = initialInv.version;

    // First update succeeds and increments version to initialVersion + 1
    await repos.productInventory.upsert(prod.id, {
      availableQuantity: 90,
      reservedQuantity: 0,
      unit: 'kg',
      expectedVersion: initialVersion,
    });

    // Second update with stale expectedVersion fails with 409
    await assert.rejects(
      async () => {
        await repos.productInventory.upsert(prod.id, {
          availableQuantity: 80,
          reservedQuantity: 0,
          unit: 'kg',
          expectedVersion: initialVersion, // Stale version!
        });
      },
      (err: unknown) => {
        const e = err as { statusCode?: number; code?: string };
        return e.statusCode === 409 || e.code === 'INVENTORY_VERSION_CONFLICT';
      },
      'Stale version update must throw 409 INVENTORY_VERSION_CONFLICT'
    );
  });

  it('14. Audit logs immutability triggers block UPDATE and DELETE statements in DB', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const logEntry = await repos.auditLogs.create({
      userId: 'test-user',
      userRole: 'ADMIN',
      action: 'TEST_IMMUTABILITY',
      entityType: 'products',
      entityId: '00000000-0000-0000-0000-000000000000',
      details: { test: true },
    });

    // Test UPDATE blockage
    await assert.rejects(
      async () => {
        await pool.query('UPDATE audit_logs SET action = $1 WHERE id = $2', ['MUTATED', logEntry.id]);
      },
      (err: unknown) => {
        const pgErr = err as { message?: string };
        return Boolean(pgErr.message?.includes('immutable') || pgErr.message?.includes('trg_audit_logs_immutability'));
      },
      'UPDATE on audit_logs must be blocked by DB immutability trigger'
    );

    // Test DELETE blockage
    await assert.rejects(
      async () => {
        await pool.query('DELETE FROM audit_logs WHERE id = $1', [logEntry.id]);
      },
      (err: unknown) => {
        const pgErr = err as { message?: string };
        return Boolean(pgErr.message?.includes('immutable') || pgErr.message?.includes('trg_audit_logs_immutability'));
      },
      'DELETE on audit_logs must be blocked by DB immutability trigger'
    );
  });

  it('15. UTF-8 and special product token preservation (30/70, 75D/36, 2070K, 40/1)', async (t) => {
    if (!TEST_DB_URL) return t.skip('LIMAX_TEST_DATABASE_URL is missing');

    const tokens = ['30/70', '75D/36', '2070K', '40/1'];

    for (const token of tokens) {
      const code = `TEST_STAGE14_2_${token}`;
      const prod = await repos.products.create({
        name: `Yarn ${token}`,
        code,
        category: 'Yarn',
        description: `Description for ${token}`,
        price: 5.5,
        currency: 'USD',
      });

      const fetched = await repos.products.findById(prod.id);
      assert.ok(fetched, `Product with token ${token} must be saved`);
      assert.strictEqual(fetched.code, code, `Product code token ${token} must be preserved without loss`);
    }
  });
});
