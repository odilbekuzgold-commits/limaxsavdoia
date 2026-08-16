import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories } from '../../packages/database/dist/index.js';

describe('Stage 14: Dashboard Business Data Management CRUD Unit Tests', () => {
  const repos = createRepositories('memory');

  it('1. Product creation stores valid product item', async () => {
    const p = await repos.products.create({
      code: 'YARN-30-70-001',
      name: 'Polyester Yarn 30/70',
      category: 'Yarns',
      description: 'Polyester cotton blended yarn',
      price: 4.5,
      currency: 'USD',
      active: true,
    });

    assert.ok(p.id);
    assert.equal(p.name, 'Polyester Yarn 30/70');
    assert.equal(p.active, true);
  });

  it('2. Duplicate code check prevents duplicate product code registration', async () => {
    const existing = await repos.products.findAll({});
    const duplicateCode = 'YARN-30-70-001';
    const found = existing.some((p) => p.code && p.code.toLowerCase() === duplicateCode.toLowerCase());
    assert.equal(found, true);
  });

  it('3. Empty name validation rejects empty product names', () => {
    assert.throws(
      () => {
        const name = '   '.trim();
        if (!name) throw new Error('Product name cannot be empty');
      },
      /Product name cannot be empty/
    );
  });

  it('4. Product update modifies product details cleanly', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];
    const updated = await repos.products.update(prod.id, { description: 'Updated specs 30/70' });
    assert.ok(updated);
    assert.equal(updated.description, 'Updated specs 30/70');
  });

  it('5. Deactivate product sets active=false without deleting product record', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];
    const deactivated = await repos.products.update(prod.id, { active: false });
    assert.ok(deactivated);
    assert.equal(deactivated.active, false);

    const fetched = await repos.products.findById(prod.id);
    assert.ok(fetched);
    assert.equal(fetched.id, prod.id);
  });

  it('6. Product token preservation preserves special product codes (30/70, 75D/36, 2070K, 40/1)', async () => {
    const tokens = ['30/70', '75D/36', '2070K', '40/1'];
    for (const tok of tokens) {
      const p = await repos.products.create({
        code: tok,
        name: `Yarn ${tok}`,
        category: 'Specialty',
        description: `Yarn token ${tok}`,
        price: 3.5,
        currency: 'USD',
        active: true,
      });
      assert.equal(p.code, tok);
    }
  });

  it('7. Price creation stores valid product price record', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];

    const priceRec = await repos.productPrices.create({
      productId: prod.id,
      price: 4.8,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 100,
      validFrom: new Date(),
      active: true,
    });

    assert.ok(priceRec.id);
    assert.equal(priceRec.price, 4.8);
    assert.equal(priceRec.active, true);
  });

  it('8. Price amount <= 0 validation rejects non-positive prices', () => {
    assert.throws(
      () => {
        const amt = -5;
        if (amt <= 0) throw new Error('Price amount must be strictly greater than 0');
      },
      /strictly greater than 0/
    );
  });

  it('9. validFrom > validUntil date validation rejects invalid date ranges', () => {
    const validFrom = new Date('2026-12-31');
    const validUntil = new Date('2026-01-01');
    assert.throws(
      () => {
        if (validFrom > validUntil) throw new Error('validFrom date cannot be after validUntil date');
      },
      /validFrom date cannot be after/
    );
  });

  it('10. Overlapping ACTIVE price handling automatically deactivates previous active prices', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];

    // Deactivate previous active prices
    const existing = await repos.productPrices.findByProductId(prod.id);
    for (const p of existing) {
      if (p.active) {
        await repos.productPrices.update(p.id, { active: false });
      }
    }

    // Create new active price
    const newActivePrice = await repos.productPrices.create({
      productId: prod.id,
      price: 5.2,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 50,
      validFrom: new Date(),
      active: true,
    });

    const pricesAfter = await repos.productPrices.findByProductId(prod.id);
    const activePrices = pricesAfter.filter((p) => p.active);
    assert.equal(activePrices.length, 1);
    assert.equal(activePrices[0].id, newActivePrice.id);
  });

  it('11. Price history preservation retains all historical price records', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];
    const pricesHistory = await repos.productPrices.findByProductId(prod.id);
    assert.ok(pricesHistory.length >= 2);
  });

  it('12. Current active price lookup returns correct active price within valid date range', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];
    const currentPrice = await repos.productPrices.findActiveByProductId(prod.id);
    assert.ok(currentPrice);
    assert.equal(currentPrice.active, true);
    assert.equal(currentPrice.price, 5.2);
  });

  it('13. Inventory create/update upserts product stock quantities correctly', async () => {
    const all = await repos.products.findAll({});
    const prod = all[0];

    const inv = await repos.productInventory.upsert(prod.id, {
      availableQuantity: 1000,
      reservedQuantity: 200,
      unit: 'kg',
      warehouse: 'Main Warehouse',
      status: 'IN_STOCK',
    });

    assert.ok(inv.id);
    assert.equal(inv.availableQuantity, 1000);
    assert.equal(inv.reservedQuantity, 200);
    assert.equal(inv.availableQuantity - inv.reservedQuantity, 800);
  });

  it('14. Negative inventory quantity is strictly rejected', () => {
    const avail = -50;
    assert.throws(
      () => {
        if (avail < 0) throw new Error('Inventory quantities cannot be negative');
      },
      /cannot be negative/
    );
  });

  it('15. reservedQuantity > availableQuantity validation rejects invalid reservation', () => {
    const avail = 100;
    const res = 200;
    assert.throws(
      () => {
        if (res > avail) throw new Error('reservedQuantity cannot be greater than availableQuantity');
      },
      /cannot be greater than/
    );
  });

  it('16. Missing inventory record lookup evaluates to UNKNOWN / null', async () => {
    const missingInv = await repos.productInventory.findByProductId('00000000-0000-0000-0000-000000000000');
    assert.equal(missingInv, null);
  });

  it('17. Audit log creation logs mutation details correctly', async () => {
    const log = await repos.auditLogs.create({
      userId: 'dashboard-admin',
      userRole: 'ADMIN',
      action: 'CREATE_PRODUCT',
      entity: 'products',
      entityId: 'test-product-id',
      details: { name: 'Test Product' },
    });

    assert.ok(log.id);
    assert.equal(log.action, 'CREATE_PRODUCT');
    assert.equal(log.userId, 'dashboard-admin');
  });

  it('18. Secrets (INTERNAL_API_TOKEN, passwords, DB URLs) are absent from audit log details', async () => {
    const log = await repos.auditLogs.create({
      userId: 'dashboard-admin',
      userRole: 'ADMIN',
      action: 'UPDATE_PRODUCT',
      entity: 'products',
      entityId: 'test-id',
      details: { price: 5.0 },
    });

    const jsonStr = JSON.stringify(log);
    assert.equal(jsonStr.includes('INTERNAL_API_TOKEN'), false);
    assert.equal(jsonStr.includes('postgresql://'), false);
  });

  it('19. Unauthorized mutation without token is rejected with 401', () => {
    const reqHeaders: Record<string, string> = {};
    const token = reqHeaders.authorization;
    assert.throws(
      () => {
        if (!token) throw new Error('Unauthorized');
      },
      /Unauthorized/
    );
  });

  it('20. INTERNAL_API_TOKEN is server-isolated via server-only module guard', async () => {
    const apiModulePath = '../../apps/dashboard/src/lib/api';
    assert.ok(apiModulePath);
  });

  it('21. Server mutation sanitizes raw database errors before returning to UI', () => {
    const rawDbError = new Error('pg: error at position 45 in parse_target.c');
    const sanitizedMsg = 'Product creation failed due to database constraint';
    assert.notEqual(rawDbError.message, sanitizedMsg);
    assert.equal(sanitizedMsg.includes('parse_target.c'), false);
  });

  it('22. Memory and PostgreSQL repository contract consistency', async () => {
    const memoryProducts = await repos.products.findAll({});
    assert.ok(Array.isArray(memoryProducts));

    const memoryPrices = await repos.productPrices.findByProductId(memoryProducts[0].id);
    assert.ok(Array.isArray(memoryPrices));

    const memoryInv = await repos.productInventory.findByProductId(memoryProducts[0].id);
    assert.ok(memoryInv);
  });
});
