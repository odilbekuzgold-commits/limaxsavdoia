import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductImportSchema,
  PriceImportSchema,
  InventoryImportSchema,
  BusinessKnowledgeImportSchema,
  validateDatabaseUrlForImport,
  importBusinessData,
} from '../../packages/database/dist/index.js';

describe('Stage 13: Business Data Import & Validation Unit Tests', () => {
  it('1. ProductImportSchema validates clean product and rejects placeholders & mojibake', () => {
    const valid = ProductImportSchema.parse({
      code: 'YARN-30-70-001',
      name: 'Polyester Yarn 30/70',
      category: 'Yarns',
      description: 'High quality polyester cotton yarn',
      unit: 'kg',
      active: true,
    });
    assert.equal(valid.code, 'YARN-30-70-001');

    // Reject placeholder
    assert.throws(
      () =>
        ProductImportSchema.parse({
          code: 'REPLACE_WITH_REAL_PRODUCT_CODE',
          name: 'Real Product',
        }),
      /unapproved placeholder/
    );

    // Reject Mojibake
    assert.throws(
      () =>
        ProductImportSchema.parse({
          code: 'YARN-002',
          name: 'ÐÐ°Ñ€Ñ…Ð»Ð°Ñ€',
        }),
      /Mojibake/
    );
  });

  it('2. PriceImportSchema enforces amount > 0 and validFrom <= validUntil', () => {
    const validPrice = PriceImportSchema.parse({
      productCode: 'YARN-30-70-001',
      amount: 4.5,
      currency: 'USD',
      status: 'ACTIVE',
      validFrom: '2026-01-01T00:00:00Z',
    });
    assert.equal(validPrice.amount, 4.5);

    // Reject amount <= 0
    assert.throws(
      () =>
        PriceImportSchema.parse({
          productCode: 'YARN-30-70-001',
          amount: 0,
          currency: 'USD',
          validFrom: '2026-01-01T00:00:00Z',
        }),
      /strictly greater than 0/
    );

    // Reject validFrom > validUntil
    assert.throws(
      () =>
        PriceImportSchema.parse({
          productCode: 'YARN-30-70-001',
          amount: 5.0,
          currency: 'USD',
          validFrom: '2026-12-31T00:00:00Z',
          validUntil: '2026-01-01T00:00:00Z',
        }),
      /validFrom date cannot be after validUntil/
    );
  });

  it('3. InventoryImportSchema enforces reservedQuantity <= availableQuantity', () => {
    const validInv = InventoryImportSchema.parse({
      productCode: 'YARN-30-70-001',
      availableQuantity: 500,
      reservedQuantity: 100,
      unit: 'kg',
    });
    assert.equal(validInv.availableQuantity, 500);

    // Reject reserved > available
    assert.throws(
      () =>
        InventoryImportSchema.parse({
          productCode: 'YARN-30-70-001',
          availableQuantity: 50,
          reservedQuantity: 100,
        }),
      /reservedQuantity cannot be greater than availableQuantity/
    );

    // Reject negative available quantity
    assert.throws(
      () =>
        InventoryImportSchema.parse({
          productCode: 'YARN-30-70-001',
          availableQuantity: -10,
          reservedQuantity: 0,
        }),
      /cannot be negative/
    );
  });

  it('4. BusinessKnowledgeImportSchema forces status = DRAFT and rejects non-DRAFT status', () => {
    const validK = BusinessKnowledgeImportSchema.parse({
      source: 'catalog_v1',
      title: 'Sales Terms',
      content: 'Minimum order 500 kg',
      language: 'uz',
      status: 'DRAFT',
    });
    assert.equal(validK.status, 'DRAFT');

    // Reject trying to import as APPROVED directly
    assert.throws(
      () =>
        BusinessKnowledgeImportSchema.parse({
          source: 'catalog_v1',
          title: 'Sales Terms',
          content: 'Minimum order 500 kg',
          language: 'uz',
          status: 'APPROVED',
        }),
      /status MUST strictly be DRAFT/
    );
  });

  it('5. validateDatabaseUrlForImport rejects production and invalid database names', () => {
    // Valid staging/test URLs
    assert.doesNotThrow(() =>
      validateDatabaseUrlForImport('postgresql://user:pass@127.0.0.1:5432/limax_test_stage13')
    );
    assert.doesNotThrow(() =>
      validateDatabaseUrlForImport('postgresql://user:pass@127.0.0.1:5432/limax_stage_v2')
    );

    // Reject production database
    assert.throws(
      () => validateDatabaseUrlForImport('postgresql://user:pass@127.0.0.1:5432/limax_production'),
      /Database name MUST start with "limax_test" or "limax_stage_"/
    );
    assert.throws(
      () => validateDatabaseUrlForImport('postgresql://user:pass@127.0.0.1:5432/postgres'),
      /Database name MUST start with "limax_test" or "limax_stage_"/
    );
  });

  it('6. Business Data Importer performs dry-run simulation correctly', async () => {
    const result = await importBusinessData({
      dryRun: true,
      productsPath: 'data/business/products.example.json',
      pricesPath: 'data/business/prices.example.json',
      inventoryPath: 'data/business/inventory.example.json',
      knowledgePath: 'data/business/knowledge.example.json',
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.success, false); // Example files contain REPLACE_WITH_REAL_DATA markers
    assert.ok(result.products.errors.some((e) => e.includes('unapproved placeholder')));
  });
});
