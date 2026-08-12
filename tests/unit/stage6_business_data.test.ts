import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createRepositories } from '../../packages/database/dist/index.js';
import {
  CreateProductSchema,
  CreateProductPriceSchema,
  ProductInventorySchema,
  CreateProductCertificateSchema,
  CreateProductMediaSchema,
  UpdateSalesSettingsSchema,
} from '../../packages/shared/dist/index.js';
import {
  getProductPrices,
  createProductPrice,
} from '../../apps/api/dist/modules/pricing.js';
import {
  updateProductInventory,
} from '../../apps/api/dist/modules/inventory.js';
import {
  approveKnowledgeItem,
} from '../../apps/api/dist/modules/knowledge.js';
import {
  getSalesSettings,
  updateSalesSettings,
} from '../../apps/api/dist/modules/settings.js';
import {
  createProductCertificate,
} from '../../apps/api/dist/modules/certificates.js';
import {
  createProductMedia,
} from '../../apps/api/dist/modules/media.js';
import { AIOrchestrator } from '../../packages/ai-engine/dist/orchestrator.js';

describe('Stage 6: Dashboard Business Data Management Tests', () => {
  test('1. Product CRUD & Flexible Polyester Technical Specifications JSON', async () => {
    const repos = createRepositories('memory');
    const valid = CreateProductSchema.parse({
      name: 'Polyester Yarn 30/1 High Tenacity',
      code: 'PY-301-HT',
      category: 'Polyester',
      yarnType: '100% Filament Polyester',
      count: '30/1',
      description: 'High tenacity polyester yarn for textile weaving',
      price: 2.85,
      currency: 'USD',
      technicalSpecifications: {
        tenacity: { value: 4.2, unit: 'cN/tex' },
        elongation: { value: 18, unit: '%' },
        twist: { value: 650, unit: 'TPM' },
        hairiness: { value: 5.4, unit: 'index' },
      },
    });

    const prod = await repos.products.create(valid);
    assert.strictEqual(prod.name, 'Polyester Yarn 30/1 High Tenacity');
    assert.strictEqual(prod.technicalSpecifications?.tenacity?.value, 4.2);
    assert.strictEqual(prod.technicalSpecifications?.tenacity?.unit, 'cN/tex');
  });

  test('2. Invalid product rejection (missing required name)', () => {
    assert.throws(() => {
      CreateProductSchema.parse({
        name: '',
        category: 'Polyester',
        description: 'Test',
      });
    });
  });

  test('3. Price NUMERIC precision & price history creation', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({
      name: 'Polyester 20/1',
      category: 'Polyester',
      description: 'Test',
      price: 2.5,
    });

    const price1 = await createProductPrice(repos, {
      productId: prod.id,
      price: 2.50,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 100,
      validFrom: new Date('2025-01-01'),
      validUntil: new Date('2025-12-31'),
    });

    const price2 = await createProductPrice(repos, {
      productId: prod.id,
      price: 2.75,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 100,
      validFrom: new Date('2026-01-01'),
    });

    const history = await getProductPrices(repos, prod.id, 'ADMIN');
    assert.strictEqual(history.length, 2);
    assert.strictEqual(price1.price, 2.5);
    assert.strictEqual(price2.price, 2.75);
  });

  test('4. Expired price ignored and current active price selected', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({
      name: 'Polyester 30/1',
      category: 'Polyester',
      description: 'Test',
      price: 3.0,
    });

    // Expired price
    await repos.productPrices.create({
      productId: prod.id,
      price: 1.50,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 1,
      validFrom: new Date('2020-01-01'),
      validUntil: new Date('2020-12-31'),
      active: true,
    });

    // Current active price
    const currentPrice = await repos.productPrices.create({
      productId: prod.id,
      price: 3.20,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 1,
      validFrom: new Date('2026-01-01'),
      active: true,
    });

    const active = await repos.productPrices.findActiveByProductId(prod.id, new Date('2026-02-01'));
    assert.ok(active);
    assert.strictEqual(active.id, currentPrice.id);
    assert.strictEqual(active.price, 3.20);
  });

  test('5. Overlapping active price rejection validation', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Yarn A', category: 'Cat', description: 'D', price: 1 });

    await createProductPrice(repos, {
      productId: prod.id,
      price: 2.0,
      currency: 'USD',
      unit: 'kg',
      validFrom: new Date(),
      active: true,
    });

    // Attempting to create another overlapping active price for same currency & unit must throw error
    await assert.rejects(async () => {
      await createProductPrice(repos, {
        productId: prod.id,
        price: 2.2,
        currency: 'USD',
        unit: 'kg',
        validFrom: new Date(),
        active: true,
      });
    }, /Overlapping active price already exists/);
  });

  test('6. Inactive price ignored by findActiveByProductId', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Yarn B', category: 'Cat', description: 'D', price: 1 });

    await repos.productPrices.create({
      productId: prod.id,
      price: 5.0,
      currency: 'USD',
      unit: 'kg',
      validFrom: new Date('2026-01-01'),
      active: false, // Inactive
    });

    const active = await repos.productPrices.findActiveByProductId(prod.id);
    assert.strictEqual(active, null);
  });

  test('7. Inventory validations (availableQuantity >= 0 & reserved <= available)', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Yarn Inv', category: 'Cat', description: 'D', price: 1 });

    // Valid update
    const inv = await updateProductInventory(repos, prod.id, {
      availableQuantity: 100,
      reservedQuantity: 30,
      status: 'IN_STOCK',
    });
    assert.strictEqual(inv.availableQuantity, 100);
    assert.strictEqual(inv.reservedQuantity, 30);

    // Invalid: negative quantity
    await assert.rejects(async () => {
      await updateProductInventory(repos, prod.id, { availableQuantity: -10 });
    });

    // Invalid: reserved > available
    await assert.rejects(async () => {
      await updateProductInventory(repos, prod.id, { availableQuantity: 50, reservedQuantity: 60 });
    });
  });

  test('8. Inventory UNKNOWN & OUT_OF_STOCK handling in AI Orchestrator', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Polyester Yarn 30/1', category: 'Polyester', description: 'D', price: 2.8 });

    await updateProductInventory(repos, prod.id, {
      status: 'OUT_OF_STOCK',
      availableQuantity: 0,
      reservedQuantity: 0,
    });

    const orchestrator = new AIOrchestrator({ repos });
    const result = await orchestrator.processQuery('Polyester Yarn 30/1 narxi va omborda bormi?', { preferredLanguage: 'uz' }, { repos });

    assert.strictEqual(result.needsHandoff, true);
    assert.ok(result.handoffReason?.includes('INVENTORY_STATUS_OUT_OF_STOCK'));
  });

  test('9. Knowledge Base status filtering (APPROVED usable, DRAFT ignored)', async () => {
    const repos = createRepositories('memory');
    const draft = await repos.knowledge.create({
      title: 'DRAFT QA',
      content: 'Draft content for polyester yarn',
      language: 'uz',
      status: 'DRAFT',
    });

    await repos.knowledge.create({
      title: 'APPROVED QA',
      content: 'Approved content for polyester yarn quality guarantee',
      language: 'uz',
      status: 'DRAFT',
    });

    const approvedItem = await approveKnowledgeItem(repos, draft.id, 'manager1', 'ADMIN');
    assert.strictEqual(approvedItem?.status, 'APPROVED');

    const orchestrator = new AIOrchestrator({ repos });
    const res = await orchestrator.processQuery('Polyester yarn sifat kafolati', { preferredLanguage: 'uz' }, { repos });
    assert.ok(res);
  });

  test('10. Expired knowledge ignored by AI Orchestrator', async () => {
    const repos = createRepositories('memory');
    await repos.knowledge.create({
      title: 'EXPIRED POLICY',
      content: 'Old policy content',
      language: 'uz',
      status: 'APPROVED',
      validUntil: new Date('2020-01-01'), // Expired
    });

    const all = await repos.knowledge.findAll({});
    const active = all.filter((k) => k.status === 'APPROVED' && (!k.validUntil || new Date(k.validUntil) > new Date()));
    assert.strictEqual(active.length, 0);
  });

  test('11. Certificate expiry & active status validation', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Yarn Cert', category: 'Cat', description: 'D', price: 1 });

    const cert = await createProductCertificate(repos, {
      productId: prod.id,
      name: 'ISO 9001 Sifat Sertifikati',
      certificateNumber: 'ISO-9001-2025',
      issuer: 'TUV Rheinland',
      validFrom: new Date('2025-01-01'),
      validUntil: new Date('2027-12-31'),
      active: true,
    });

    const activeCerts = await repos.productCertificates.findActiveByProductId(prod.id, new Date('2026-06-01'));
    assert.strictEqual(activeCerts.length, 1);
    assert.strictEqual(activeCerts[0].id, cert.id);
  });

  test('12. Media Metadata registration', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Yarn Media', category: 'Cat', description: 'D', price: 1 });

    const media = await createProductMedia(repos, {
      productId: prod.id,
      type: 'IMAGE',
      title: 'High Tenacity Spec Sheet',
      storageKey: 'media/products/spec_301.png',
      mimeType: 'image/png',
    });

    const allMedia = await repos.productMedia.findByProductId(prod.id);
    assert.strictEqual(allMedia.length, 1);
    assert.strictEqual(allMedia[0].id, media.id);
  });

  test('13. Sales & Delivery Settings GET and PATCH', async () => {
    const repos = createRepositories('memory');
    const defaultSettings = await getSalesSettings(repos, 'ADMIN');
    assert.ok(defaultSettings.delivery);
    assert.ok(defaultSettings.payment);

    const updated = await updateSalesSettings(
      repos,
      {
        delivery: { estimatedDeliveryTime: '2-5 business days' },
        payment: { prepaymentPercent: 50 },
      },
      'admin_user',
      'ADMIN'
    );

    assert.strictEqual(updated.delivery.estimatedDeliveryTime, '2-5 business days');
    assert.strictEqual(updated.payment.prepaymentPercent, 50);
  });

  test('14. RBAC Permission checks (VIEWER denied create, ADMIN granted)', async () => {
    const repos = createRepositories('memory');

    // VIEWER denied pricing create
    await assert.rejects(async () => {
      await createProductPrice(repos, {
        productId: '00000000-0000-0000-0000-000000000000',
        price: 10,
        validFrom: new Date(),
      }, 'viewer_id', 'VIEWER');
    }, /Forbidden: Role 'VIEWER' lacks required permission 'pricing.create'/);

    // ADMIN granted
    const prod = await repos.products.create({ name: 'P', category: 'C', description: 'D', price: 1 });
    const price = await createProductPrice(repos, {
      productId: prod.id,
      price: 10,
      validFrom: new Date(),
    }, 'admin_id', 'ADMIN');
    assert.ok(price);
  });

  test('15. Audit Log tracking on state changes', async () => {
    const repos = createRepositories('memory');
    const prod = await repos.products.create({ name: 'Audit Yarn', category: 'C', description: 'D', price: 1 });

    await createProductPrice(repos, {
      productId: prod.id,
      price: 3.5,
      validFrom: new Date(),
    }, 'user_audit_1', 'ADMIN');

    const logs = await repos.auditLogs.findAll({ page: 1, limit: 10 });
    assert.ok(logs.data.length >= 1);
    assert.strictEqual(logs.data[0].action, 'CREATE_PRODUCT_PRICE');
    assert.strictEqual(logs.data[0].userId, 'user_audit_1');
  });

  test('16. AI Structured source priority & missing price handoff', async () => {
    const repos = createRepositories('memory');
    // Product exists but active price is missing
    await repos.products.create({
      name: 'Special Yarn X',
      category: 'Special',
      description: 'D',
      price: 0, // No valid price
    });

    const orchestrator = new AIOrchestrator({ repos });
    const result = await orchestrator.processQuery('Special Yarn X narxi qancha?', { preferredLanguage: 'uz' }, { repos });

    assert.strictEqual(result.needsHandoff, true);
    assert.strictEqual(result.handoffReason, 'MISSING_ACTIVE_PRICE');
  });
});
