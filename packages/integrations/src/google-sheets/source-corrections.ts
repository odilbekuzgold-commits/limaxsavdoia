import type { SheetProductRow, SheetPriceRow, SheetInventoryRow } from './schemas.js';

export interface CorrectionManifestItem {
  sheet: 'Products' | 'Prices' | 'Inventory' | 'Sync_Control';
  rowId: string;
  field: string;
  originalValue: string | number | boolean | null | undefined;
  correctedValue: string | number | boolean | null | undefined;
  reason: string;
}

export interface SheetCorrectionsResult {
  manifest: CorrectionManifestItem[];
  products: SheetProductRow[];
  prices: SheetPriceRow[];
  inventory: SheetInventoryRow[];
}

export function applyStage17_2SourceCorrections(
  rawProducts: SheetProductRow[],
  rawPrices: SheetPriceRow[],
  rawInventory: SheetInventoryRow[]
): SheetCorrectionsResult {
  const manifest: CorrectionManifestItem[] = [];

  // 1. Process Products
  const products: SheetProductRow[] = rawProducts.map((p) => {
    let category = p.category;
    let color = p.color;
    let productName = p.productName;
    let count = p.count || '';
    let notes = p.notes || '';

    // Rule: Spun 32S MIX COLOR -> MIC COLOR (Only SPUN-32S-MIX / Spun 32S)
    if (p.productCode === 'SPUN-32S-MIX' || (category.includes('Spun 32S') && color === 'MIX COLOR')) {
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'color',
        originalValue: color,
        correctedValue: 'MIC COLOR',
        reason: 'Raw label image specifies MIC COLOR for Spun 32S',
      });
      color = 'MIC COLOR';
    }

    // Rule: Category transliterations / translations
    // Neylonli mexanik spandeks -> Neylonli Mexanicheskiy spandeks
    if (category === 'Neylonli mexanik spandeks') {
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'category',
        originalValue: category,
        correctedValue: 'Neylonli Mexanicheskiy spandeks',
        reason: 'Preserve source Russian/transliterated label Mexanicheskiy',
      });
      category = 'Neylonli Mexanicheskiy spandeks';
    } else if (category === 'Mexanik spandeks') {
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'category',
        originalValue: category,
        correctedValue: 'Mexanicheskiy spandeks',
        reason: 'Preserve source Russian/transliterated label Mexanicheskiy',
      });
      category = 'Mexanicheskiy spandeks';
    } else if (category === 'Neylonli havo spandeksi') {
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'category',
        originalValue: category,
        correctedValue: 'Neylonli Vozdushniy spandeks',
        reason: 'Preserve source Russian/transliterated label Vozdushniy',
      });
      category = 'Neylonli Vozdushniy spandeks';
    } else if (category === 'Havo spandeksi') {
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'category',
        originalValue: category,
        correctedValue: 'Vozdushniy spandeks',
        reason: 'Preserve source Russian/transliterated label Vozdushniy',
      });
      category = 'Vozdushniy spandeks';
    }

    // Rule: Polyester -> Poliester
    if (category.includes('Polyester')) {
      const orig = category;
      category = category.replace(/Polyester/g, 'Poliester');
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'category',
        originalValue: orig,
        correctedValue: category,
        reason: 'Normalize Uzbekistan industry terminology Polyester -> Poliester',
      });
    }

    // Rule: Neylon 40D/1, 40D/2, 70D/1, 70D/2 color must be empty; remove STANDARD
    if (p.productCode.startsWith('NYL-40D') || p.productCode.startsWith('NYL-70D') || color === 'STANDARD') {
      manifest.push({
        sheet: 'Products',
        rowId: p.productCode,
        field: 'color',
        originalValue: color,
        correctedValue: '',
        reason: 'Source image has empty color for Neylon 40D/70D; remove temporary STANDARD placeholder',
      });
      color = '';
    }

    // Recompute productName from raw category, count and color
    const parts = [category, count, color].filter(Boolean);
    const newName = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (newName && newName !== p.productName) {
      productName = newName;
    }

    // Remove temporary notes like "40100K yoki 40/100K?" and "tasdiqlash kerak"
    if (notes.includes('40100K') || notes.includes('tasdiqlash kerak') || notes.includes('vaqtinchalik')) {
      notes = '';
    }

    return {
      ...p,
      category,
      color,
      productName,
      yarnType: category,
      count,
      notes,
      syncEnabled: true,
      approvalStatus: 'APPROVED',
    };
  });

  // 2. Process Prices (Activate all 170 prices, remove temporary notes, clear temporary minOrderQuantity=1)
  const prices: SheetPriceRow[] = rawPrices.map((pr) => {
    let notes = pr.notes || '';
    if (notes.includes('40100K') || notes.includes('tasdiqlash kerak')) {
      notes = '';
    }

    manifest.push({
      sheet: 'Prices',
      rowId: `${pr.productCode}_${pr.paymentType}`,
      field: 'minOrderQuantity',
      originalValue: pr.minOrderQuantity,
      correctedValue: null,
      reason: 'Google Sheet has no confirmed MOQ; clear temporary 1 kg to prevent assumption',
    });

    return {
      ...pr,
      currency: 'USD',
      unit: 'kg',
      minOrderQuantity: undefined,
      notes,
      syncEnabled: true,
      approvalStatus: 'APPROVED',
    };
  });

  // 3. Process Inventory (Keep BLOCKED, stockStatus UNKNOWN, syncEnabled FALSE)
  const inventory: SheetInventoryRow[] = rawInventory.map((inv) => ({
    ...inv,
    availableQuantity: null,
    reservedQuantity: 0,
    syncEnabled: false,
    approvalStatus: 'BLOCKED',
  }));

  return {
    manifest,
    products,
    prices,
    inventory,
  };
}
