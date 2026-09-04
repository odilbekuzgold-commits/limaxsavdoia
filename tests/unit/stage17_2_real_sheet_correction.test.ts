import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  applyStage17_2SourceCorrections,
  type SheetProductRow,
  type SheetPriceRow,
  type SheetInventoryRow,
} from '../../packages/integrations/dist/google-sheets/index.js';

describe('Stage 17.2: Real Sheet Correction, Source Fidelity & Price Activation Unit Tests', () => {
  const sampleRawProducts: SheetProductRow[] = [
    {
      rowNumber: 1,
      productCode: 'SPUN-32S-BLK',
      productName: 'Spun 32S/1 32S BLACK',
      category: 'Spun 32S/1',
      color: 'BLACK',
      yarnType: 'Spun 32S/1',
      count: '32S',
      composition: '',
      description: '',
      unit: 'kg',
      active: true,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: '',
    },
    {
      rowNumber: 2,
      productCode: 'SPUN-32S-MIX',
      productName: 'Spun 32S/1 32S MIX COLOR',
      category: 'Spun 32S/1',
      color: 'MIX COLOR',
      yarnType: 'Spun 32S/1',
      count: '32S',
      composition: '',
      description: '',
      unit: 'kg',
      active: true,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: '',
    },
    {
      rowNumber: 3,
      productCode: 'NYL-40D1-STD',
      productName: 'Neylon 40D/1 STANDARD',
      category: 'Neylon',
      color: 'STANDARD',
      yarnType: 'Neylon',
      count: '40D/1',
      composition: '',
      description: '',
      unit: 'kg',
      active: true,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: 'Manba rasmida rang bo\'sh; STANDARD vaqtinchalik qo\'yildi.',
    },
    {
      rowNumber: 4,
      productCode: 'VS-40100K-BLK',
      productName: 'Havo spandeksi 40100K BLACK',
      category: 'Havo spandeksi',
      color: 'BLACK',
      yarnType: 'Havo spandeksi',
      count: '40100K',
      composition: '',
      description: '',
      unit: 'kg',
      active: true,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: '40100K yoki 40/100K? Tasdiqlash kerak.',
    },
    {
      rowNumber: 5,
      productCode: 'MS-2075-MIX',
      productName: 'Mexanik spandeks 2075 MIX COLOR',
      category: 'Mexanik spandeks',
      color: 'MIX COLOR',
      yarnType: 'Mexanik spandeks',
      count: '2075',
      composition: '',
      description: '',
      unit: 'kg',
      active: true,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: '',
    },
  ];

  const sampleRawPrices: SheetPriceRow[] = [
    {
      rowNumber: 1,
      productCode: 'VS-40100K-BLK',
      paymentType: 'BANK_TRANSFER',
      amount: 2.39,
      currency: 'USD',
      unit: 'kg',
      minOrderQuantity: 1,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: 'O‘tkazma narxi, jadval sarlavhasiga ko‘ra +12%. Tasdiqlash kerak.',
    },
    {
      rowNumber: 2,
      productCode: 'VS-40100K-BLK',
      paymentType: 'CASH',
      amount: 2.5,
      currency: 'USD',
      unit: 'kg',
      minOrderQuantity: 1,
      approvalStatus: 'PENDING_APPROVAL',
      syncEnabled: false,
      notes: 'Naqd narx. Tasdiqlash kerak.',
    },
  ];

  const sampleRawInventory: SheetInventoryRow[] = [
    {
      rowNumber: 1,
      productCode: 'VS-40100K-BLK',
      availableQuantity: null,
      reservedQuantity: 0,
      unit: 'kg',
      warehouse: '',
      approvalStatus: 'BLOCKED',
      syncEnabled: false,
      notes: 'Haqiqiy ombor soni kiritilmaguncha sync yoqilmasin.',
    },
  ];

  it('1. Spun 32S MIX COLOR is strictly corrected to MIC COLOR', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    const pSpunMix = res.products.find((p) => p.productCode === 'SPUN-32S-MIX');
    assert.strictEqual(pSpunMix?.color, 'MIC COLOR', 'Spun 32S color must be MIC COLOR');
    assert.strictEqual(pSpunMix?.productName, 'Spun 32S/1 32S MIC COLOR');
  });

  it('2. Other MIX COLOR items (e.g. Mexanik spandeks 2075) remain MIX COLOR and are NOT altered to MIC COLOR', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    const pOtherMix = res.products.find((p) => p.productCode === 'MS-2075-MIX');
    assert.strictEqual(pOtherMix?.color, 'MIX COLOR', 'Other products must remain MIX COLOR');
  });

  it('3. Neylon 40D/70D items have STANDARD placeholder removed and color blanked', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    const pNyl = res.products.find((p) => p.productCode === 'NYL-40D1-STD');
    assert.strictEqual(pNyl?.color, '', 'Color must be empty string');
    assert.strictEqual(pNyl?.productName, 'Neylon 40D/1', 'STANDARD must not be part of product name');
  });

  it('4. Categories with Mexanik/Havo spandeks are transliterated to Mexanicheskiy/Vozdushniy spandeks', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    const p40100 = res.products.find((p) => p.productCode === 'VS-40100K-BLK');
    assert.strictEqual(p40100?.category, 'Vozdushniy spandeks', 'Havo spandeksi must be Vozdushniy spandeks');
    assert.strictEqual(p40100?.count, '40100K', '40100K raw token must be preserved');
    assert.strictEqual(p40100?.productName, 'Vozdushniy spandeks 40100K BLACK');

    const pMex = res.products.find((p) => p.productCode === 'MS-2075-MIX');
    assert.strictEqual(pMex?.category, 'Mexanicheskiy spandeks', 'Mexanik spandeks must be Mexanicheskiy spandeks');
  });

  it('5. 40100K BANK_TRANSFER and CASH prices are APPROVED and currency/unit confirmed', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    const bankPrice = res.prices.find((pr) => pr.productCode === 'VS-40100K-BLK' && pr.paymentType === 'BANK_TRANSFER');
    const cashPrice = res.prices.find((pr) => pr.productCode === 'VS-40100K-BLK' && pr.paymentType === 'CASH');

    assert.strictEqual(bankPrice?.amount, 2.39, 'BANK_TRANSFER must be 2.39 USD');
    assert.strictEqual(bankPrice?.approvalStatus, 'APPROVED');
    assert.strictEqual(bankPrice?.syncEnabled, true);

    assert.strictEqual(cashPrice?.amount, 2.5, 'CASH must be 2.50 USD');
    assert.strictEqual(cashPrice?.approvalStatus, 'APPROVED');
    assert.strictEqual(cashPrice?.syncEnabled, true);
  });

  it('6. Inventory remains BLOCKED with null available quantity and syncEnabled FALSE', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    assert.strictEqual(res.inventory.length, 1);
    assert.strictEqual(res.inventory[0].approvalStatus, 'BLOCKED');
    assert.strictEqual(res.inventory[0].syncEnabled, false);
    assert.strictEqual(res.inventory[0].availableQuantity, null);
  });

  it('7. Correction manifest tracks every cell transformation with rowId and reason', () => {
    const res = applyStage17_2SourceCorrections(sampleRawProducts, sampleRawPrices, sampleRawInventory);
    assert.ok(res.manifest.length >= 4, 'Manifest must contain all transformation entries');
    const micEntry = res.manifest.find((m) => m.field === 'color' && m.correctedValue === 'MIC COLOR');
    assert.ok(micEntry, 'MIC COLOR transformation must be in manifest');
  });
});
