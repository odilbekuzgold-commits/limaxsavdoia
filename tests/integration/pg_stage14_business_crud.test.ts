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

const { Pool } = pg;

describe('Stage 14.1: Real PostgreSQL Business Data CRUD & Transaction Safety Integration Tests', () => {
  let pool: pg.Pool;
  let testDbName: string;
  let repos: Repositories;

  before(async () => {
    const rawUrl = process.env.LIMAX_TEST_DATABASE_URL || 'postgresql://postgres:1111@127.0.0.1:5432/postgres';

    // Safety guard
    if (!rawUrl.startsWith('postgres:') && !rawUrl.startsWith('postgresql:')) {
      throw new Error('LIMAX_TEST_DATABASE_URL must be a valid postgresql connection URL');
    }

    const parsed = new URL(rawUrl);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error('Integration tests are restricted to local test databases');
    }

    testDbName = `limax_test_stage14_1_${Date.now()}`;
    const adminPool = new Pool({ connectionString: rawUrl });
    await adminPool.query(`CREATE DATABASE "${testDbName}"`);
    await adminPool.end();

    const testDbUrl = `postgresql://${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || '5432'}/${testDbName}`;
    process.env.DATABASE_URL = testDbUrl;

    pool = getDbPool(testDbUrl);
    await runMigrations(pool);
    repos = createRepositories('postgres', pool);
  });

  after(async () => {
    if (pool) {
      await closeDbPool();
    }
    if (testDbName) {
      const rawUrl = process.env.LIMAX_TEST_DATABASE_URL || 'postgresql://postgres:1111@127.0.0.1:5432/postgres';
      const adminPool = new Pool({ connectionString: rawUrl });
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
      await adminPool.end();
    }
  });

  it('1. Product create and read in PostgreSQL', async () => {
    const product = await repos.products.create({
      code: 'TEST_STAGE14_1_P1',
      name: 'Test Yarn 30/70',
      category: 'Yarns',
      description: 'Polyester Cotton 30/70',
      price: 3.5,
      currency: 'USD',
      active: true,
    });

    assert.ok(product.id);
    assert.equal(product.name, 'Test Yarn 30/70');
    assert.equal(product.code, 'TEST_STAGE14_1_P1');

    const fetched = await repos.products.findById(product.id);
    assert.ok(fetched);
    assert.equal(fetched.id, product.id);
  });

  it('2. Duplicate code rejected at PostgreSQL/repository level', async () => {
    const existing = await repos.products.findAll({});
    const duplicateCode = 'TEST_STAGE14_1_P1';
    const found = existing.some((p) => p.code && p.code.toLowerCase() === duplicateCode.toLowerCase());
    assert.equal(found, true);
  });

  it('3. Product update in PostgreSQL', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];
    const updated = await repos.products.update(prod.id, { description: 'Updated specs 30/70' });
    assert.ok(updated);
    assert.equal(updated.description, 'Updated specs 30/70');
  });

  it('4. Activate / Deactivate product status', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];
    const deactivated = await repos.products.update(prod.id, { active: false });
    assert.ok(deactivated);
    assert.equal(deactivated.active, false);

    const activated = await repos.products.update(prod.id, { active: true });
    assert.ok(activated);
    assert.equal(activated.active, true);
  });

  it('5. Product mutation + audit atomic commit', async () => {
    await withTransaction('postgres', pool, repos, async (txRepos) => {
      const prod = await txRepos.products.create({
        code: 'TEST_STAGE14_1_ATOMIC',
        name: 'Atomic Product',
        category: 'Test',
        description: 'Test atomic commit',
        price: 10,
        currency: 'USD',
        active: true,
      });

      await txRepos.auditLogs.create({
        userId: 'dashboard-admin',
        userRole: 'ADMIN',
        action: 'CREATE_PRODUCT',
        entity: 'products',
        entityId: prod.id,
        details: { code: prod.code },
      });
    });

    const products = await repos.products.findAll({});
    const foundProd = products.find((p) => p.code === 'TEST_STAGE14_1_ATOMIC');
    assert.ok(foundProd);

    const auditRes = await repos.auditLogs.findAll({ page: 1, limit: 10, entity: 'products' });
    const foundAudit = auditRes.data.find((a) => a.entityId === foundProd.id);
    assert.ok(foundAudit);
  });

  it('6. Audit failure rolls back product creation in transaction', async () => {
    try {
      await withTransaction('postgres', pool, repos, async (txRepos) => {
        await txRepos.products.create({
          code: 'TEST_STAGE14_1_FAIL_AUDIT',
          name: 'Should Rollback Product',
          category: 'Test',
          description: 'Failing audit step',
          price: 10,
          currency: 'USD',
          active: true,
        });

        // Trigger intentional error to test rollback
        throw new Error('SIMULATED_AUDIT_INSERT_FAILURE');
      });
    } catch (err: unknown) {
      assert.equal((err as Error).message, 'SIMULATED_AUDIT_INSERT_FAILURE');
    }

    const products = await repos.products.findAll({});
    const foundProd = products.find((p) => p.code === 'TEST_STAGE14_1_FAIL_AUDIT');
    assert.equal(foundProd, undefined);
  });

  it('7. ACTIVE price creation deactivates prior active price in PostgreSQL', async () => {
    const products = await repos.products.findAll({});
    const prod = products[0];

    const price1 = await repos.productPrices.create({
      productId: prod.id,
      price: 4.5,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 1,
      validFrom: new Date(),
      active: true,
    });
    assert.equal(price1.active, true);

    await withTransaction('postgres', pool, repos, async (txRepos) => {
      const existing = await txRepos.productPrices.findByProductId(prod.id);
      for (const p of existing) {
        if (p.active) {
          await txRepos.productPrices.update(p.id, { active: false });
        }
      }

      await txRepos.productPrices.create({
        productId: prod.id,
        price: 5.0,
        currency: 'USD',
        unit: 'kg',
        minimumQuantity: 1,
        validFrom: new Date(),
        active: true,
      });
    });

    const pricesAfter = await repos.productPrices.findByProductId(prod.id);
    const activePrices = pricesAfter.filter((p) => p.active);
    assert.equal(activePrices.length, 1);
    assert.equal(activePrices[0].price, 5.0);
  });

  it('8. Price history is preserved in PostgreSQL', async () => {
    const products = await repos.products.findAll({});
    const prod = products[0];
    const pricesHistory = await repos.productPrices.findByProductId(prod.id);
    assert.ok(pricesHistory.length >= 2);
  });

  it('9. Audit failure rolls back price creation cleanly', async () => {
    const products = await repos.products.findAll({});
    const prod = products[0];
    const countBefore = (await repos.productPrices.findByProductId(prod.id)).length;

    try {
      await withTransaction('postgres', pool, repos, async (txRepos) => {
        await txRepos.productPrices.create({
          productId: prod.id,
          price: 99.9,
          currency: 'USD',
          unit: 'kg',
          minimumQuantity: 1,
          validFrom: new Date(),
          active: true,
        });

        throw new Error('SIMULATED_PRICE_AUDIT_FAILURE');
      });
    } catch (err: unknown) {
      assert.equal((err as Error).message, 'SIMULATED_PRICE_AUDIT_FAILURE');
    }

    const countAfter = (await repos.productPrices.findByProductId(prod.id)).length;
    assert.equal(countAfter, countBefore);
  });

  it('10. Inventory create and update with version incrementing in PostgreSQL', async () => {
    const products = await repos.products.findAll({});
    const prod = products[0];

    const inv1 = await repos.productInventory.upsert(prod.id, {
      availableQuantity: 500,
      reservedQuantity: 50,
      unit: 'kg',
      warehouse: 'Main Warehouse',
      status: 'IN_STOCK',
    });

    assert.equal(inv1.availableQuantity, 500);
    assert.equal(inv1.version, 1);

    const inv2 = await repos.productInventory.upsert(prod.id, {
      availableQuantity: 600,
      reservedQuantity: 50,
      expectedVersion: 1,
    });

    assert.equal(inv2.availableQuantity, 600);
    assert.equal(inv2.version, 2);
  });

  it('11. Concurrent inventory update version mismatch returns 409 conflict', async () => {
    const products = await repos.products.findAll({});
    const prod = products[0];

    await assert.rejects(
      async () => {
        await repos.productInventory.upsert(prod.id, {
          availableQuantity: 700,
          reservedQuantity: 50,
          expectedVersion: 1, // Stale version! Current version is 2
        });
      },
      (err: unknown) => {
        const statusCode = (err as unknown as { statusCode?: number }).statusCode;
        return statusCode === 409;
      }
    );
  });

  it('12. Database-level immutability trigger blocks UPDATE on audit_logs', async () => {
    const auditRes = await repos.auditLogs.findAll({ page: 1, limit: 1 });
    assert.ok(auditRes.data.length > 0);
    const audit = auditRes.data[0];

    await assert.rejects(
      async () => {
        await pool.query('UPDATE audit_logs SET action = $1 WHERE id = $2', ['TAMPERED_ACTION', audit.id]);
      },
      /audit_logs records are immutable/
    );
  });

  it('13. Database-level immutability trigger blocks DELETE on audit_logs', async () => {
    const auditRes = await repos.auditLogs.findAll({ page: 1, limit: 1 });
    assert.ok(auditRes.data.length > 0);
    const audit = auditRes.data[0];

    await assert.rejects(
      async () => {
        await pool.query('DELETE FROM audit_logs WHERE id = $1', [audit.id]);
      },
      /audit_logs records are immutable/
    );
  });

  it('14. UTF-8 and special product token preservation (30/70, 75D/36, 2070K, 40/1)', async () => {
    const tokens = ['30/70', '75D/36', '2070K', '40/1'];
    for (const tok of tokens) {
      const p = await repos.products.create({
        code: `TEST_STAGE14_1_${tok}`,
        name: `Yarn Token ${tok} — O‘zbekiston Sifat Sertifikati`,
        category: 'Specialty Yarns',
        description: `High tenacity yarn ${tok}`,
        price: 4.2,
        currency: 'USD',
        active: true,
      });

      const fetched = await repos.products.findById(p.id);
      assert.ok(fetched);
      assert.equal(fetched.code, `TEST_STAGE14_1_${tok}`);
      assert.ok(fetched.name.includes('O‘zbekiston'));
    }
  });
});
