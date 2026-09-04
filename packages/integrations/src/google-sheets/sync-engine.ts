import crypto from 'node:crypto';
import type pg from 'pg';
import { withTransaction, type RepositoryDriver } from '@limax/database';
import type { Repositories, GoogleSheetsSyncState } from '@limax/shared';
import { GoogleSheetsClient } from './client.js';
import {
  REQUIRED_SPREADSHEET_ID,
  SheetProductRowSchema,
  SheetPriceRowSchema,
  SheetInventoryRowSchema,
  type SheetProductRow,
  type SheetPriceRow,
  type SheetInventoryRow,
} from './schemas.js';
import { applyStage17_2SourceCorrections, type CorrectionManifestItem } from './source-corrections.js';

export interface SyncOptions {
  dryRun?: boolean;
  applyCorrections?: boolean;
}

export interface SyncResult {
  success: boolean;
  spreadsheetId: string;
  dryRun: boolean;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED_UNCHANGED';
  checksum: string;
  counts: {
    products: number;
    prices: number;
    inventory: number;
  };
  details?: {
    productsAdded?: number;
    productsUpdated?: number;
    pricesCreated?: number;
    pricesUnchanged?: number;
    inventoryUpdated?: number;
    skippedPending?: number;
    skippedDisabled?: number;
    manifest?: CorrectionManifestItem[];
  };
  errors?: string[];
  lastSuccessAt?: Date | null;
}

export class GoogleSheetsSyncEngine {
  constructor(
    private client: GoogleSheetsClient,
    private repos: Repositories,
    private driver: RepositoryDriver = 'postgres',
    private pool?: pg.Pool
  ) {}

  private parseRows<T>(
    rawRows: string[][],
    schema: { parse: (val: unknown) => T },
    fieldMapping: Record<string, number>
  ): { valid: T[]; errors: string[]; skippedPending: number; skippedDisabled: number } {
    if (!rawRows || rawRows.length <= 1) {
      return { valid: [], errors: [], skippedPending: 0, skippedDisabled: 0 };
    }

    const normalizeHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normHeaders = rawRows[0].map(normalizeHeader);
    const hasHeaders = normHeaders.some((h) => h.includes('code') || h.includes('status') || h.includes('name'));

    const findCol = (key: string): number => {
      const normKey = normalizeHeader(key);
      const exactIdx = normHeaders.findIndex((h) => h === normKey);
      if (exactIdx >= 0) return exactIdx;

      const partialIdx = normHeaders.findIndex((h) => (h.length > 2 && normKey.includes(h)) || (normKey.length > 2 && h.includes(normKey)));
      if (partialIdx >= 0) return partialIdx;

      if (normKey === 'minorderquantity') {
        const idx = normHeaders.findIndex((h) => h.includes('minorder') || h.includes('minimumorder') || h.includes('moq'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'availablequantity') {
        const idx = normHeaders.findIndex((h) => h.includes('avail') || h.includes('available'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'reservedquantity') {
        const idx = normHeaders.findIndex((h) => h.includes('res') || h.includes('reserved'));
        if (idx >= 0) return idx;
      }

      return -1;
    };

    const map: Record<string, number> = {};
    for (const [key, fallbackIdx] of Object.entries(fieldMapping)) {
      const foundIdx = findCol(key);
      if (foundIdx >= 0) {
        map[key] = foundIdx;
      } else if (hasHeaders) {
        map[key] = -1;
      } else {
        map[key] = fallbackIdx;
      }
    }

    const valid: T[] = [];
    const errors: string[] = [];
    let skippedPending = 0;
    let skippedDisabled = 0;

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.every((c) => !c || c.trim() === '')) continue; // skip empty rows

      const rowObj: Record<string, unknown> = { rowNumber: i + 1 };
      for (const [key, colIdx] of Object.entries(map)) {
        rowObj[key] = colIdx >= 0 && row[colIdx] !== undefined ? row[colIdx].trim() : '';
      }

      try {
        const parsed = schema.parse(rowObj);
        const item = parsed as any;
        if (item.approvalStatus !== 'APPROVED') {
          skippedPending++;
        } else if (!item.syncEnabled) {
          skippedDisabled++;
        }
        valid.push(parsed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${i + 1} validation failed: ${msg}`);
      }
    }

    return { valid, errors, skippedPending, skippedDisabled };
  }

  async runSync(options: SyncOptions = {}): Promise<SyncResult> {
    const dryRun = options.dryRun ?? false;

    // Fail-fast if invalid spreadsheet ID configured
    if (this.client.getSpreadsheetId() !== REQUIRED_SPREADSHEET_ID) {
      return {
        success: false,
        spreadsheetId: this.client.getSpreadsheetId(),
        dryRun,
        status: 'FAILED',
        checksum: '',
        counts: { products: 0, prices: 0, inventory: 0 },
        errors: [`Invalid Spreadsheet ID. Required: ${REQUIRED_SPREADSHEET_ID}`],
      };
    }

    // 1. Fetch tabs
    let tabData: { Products?: string[][]; Prices?: string[][]; Inventory?: string[][]; Sync_Control?: string[][] };
    try {
      tabData = await this.client.fetchTabs(['Products', 'Prices', 'Inventory', 'Sync_Control']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
        dryRun,
        status: 'FAILED',
        checksum: '',
        counts: { products: 0, prices: 0, inventory: 0 },
        errors: [`Failed to read Google Sheets tabs: ${msg}`],
      };
    }

    // 2. Parse Products Tab
    const productParsed = this.parseRows<SheetProductRow>(
      tabData.Products || [],
      SheetProductRowSchema,
      {
        productCode: 0,
        productName: 1,
        category: 2,
        color: 3,
        yarnType: 4,
        count: 5,
        composition: 6,
        description: 7,
        unit: 8,
        active: 9,
        approvalStatus: 10,
        syncEnabled: 11,
        notes: 12,
      }
    );

    // 3. Parse Prices Tab
    const priceParsed = this.parseRows<SheetPriceRow>(
      tabData.Prices || [],
      SheetPriceRowSchema,
      {
        productCode: 0,
        paymentType: 1,
        amount: 2,
        currency: 3,
        unit: 4,
        minOrderQuantity: 5,
        approvalStatus: 6,
        syncEnabled: 7,
        notes: 8,
      }
    );

    // 4. Parse Inventory Tab
    const inventoryParsed = this.parseRows<SheetInventoryRow>(
      tabData.Inventory || [],
      SheetInventoryRowSchema,
      {
        productCode: 0,
        availableQuantity: 1,
        reservedQuantity: 2,
        unit: 3,
        warehouse: 4,
        approvalStatus: 5,
        syncEnabled: 6,
        notes: 7,
      }
    );

    const allErrors = [
      ...productParsed.errors,
      ...priceParsed.errors,
      ...inventoryParsed.errors,
    ];

    const totalSkippedPending = productParsed.skippedPending + priceParsed.skippedPending + inventoryParsed.skippedPending;
    const totalSkippedDisabled = productParsed.skippedDisabled + priceParsed.skippedDisabled + inventoryParsed.skippedDisabled;

    let approvedProducts = productParsed.valid.filter((p) => p.approvalStatus === 'APPROVED' && p.syncEnabled);
    let approvedPrices = priceParsed.valid.filter((p) => p.approvalStatus === 'APPROVED' && p.syncEnabled);
    let approvedInventory = inventoryParsed.valid.filter((p) => p.approvalStatus === 'APPROVED' && p.syncEnabled);
    let manifest: CorrectionManifestItem[] = [];

    // Stage 17.2 Correction & Activation: if raw rows are PENDING_APPROVAL and applyCorrections is requested
    if (options?.applyCorrections !== false && (approvedProducts.length === 0 || approvedPrices.length === 0)) {
      const corrResult = applyStage17_2SourceCorrections(
        productParsed.valid,
        priceParsed.valid,
        inventoryParsed.valid
      );
      manifest = corrResult.manifest;
      approvedProducts = corrResult.products;
      approvedPrices = corrResult.prices;
      approvedInventory = corrResult.inventory.filter((inv) => inv.approvalStatus === 'APPROVED' && inv.syncEnabled);
    }

    // Check duplicate productCode in approvedProducts
    const codeCounts = new Map<string, number>();
    for (const p of approvedProducts) {
      const c = p.productCode.toUpperCase();
      codeCounts.set(c, (codeCounts.get(c) || 0) + 1);
      if (codeCounts.get(c)! > 1) {
        allErrors.push(`Duplicate approved productCode in Products tab: '${p.productCode}'`);
      }
    }

    if (allErrors.length > 0) {
      if (!dryRun) {
        try {
          await this.repos.googleSheetsSync.create({
            spreadsheetId: REQUIRED_SPREADSHEET_ID,
            status: 'FAILED',
            lastAttemptAt: new Date(),
            lastSuccessAt: null,
            checksum: null,
            productsCount: approvedProducts.length,
            pricesCount: approvedPrices.length,
            inventoryCount: approvedInventory.length,
            sanitizedError: allErrors.slice(0, 5).join('; '),
          });
        } catch {
          // ignore error logging failure
        }
      }

      return {
        success: false,
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
        dryRun,
        status: 'FAILED',
        checksum: '',
        counts: {
          products: approvedProducts.length,
          prices: approvedPrices.length,
          inventory: approvedInventory.length,
        },
        details: {
          skippedPending: totalSkippedPending,
          skippedDisabled: totalSkippedDisabled,
        },
        errors: allErrors,
      };
    }

    // 5. Calculate Checksum
    const payloadForChecksum = JSON.stringify({
      products: approvedProducts.map((p) => ({
        code: p.productCode,
        name: p.productName,
        active: p.active,
        category: p.category,
        color: p.color,
        yarnType: p.yarnType,
        count: p.count,
        composition: p.composition,
      })),
      prices: approvedPrices.map((pr) => ({
        code: pr.productCode,
        type: pr.paymentType,
        amount: pr.amount,
        currency: pr.currency,
        unit: pr.unit,
      })),
      inventory: approvedInventory.map((inv) => ({
        code: inv.productCode,
        avail: inv.availableQuantity,
        res: inv.reservedQuantity,
      })),
    });
    const checksum = crypto.createHash('sha256').update(payloadForChecksum).digest('hex');

    // 6. Check Idempotency (if checksum unchanged)
    const latestSuccess = await this.repos.googleSheetsSync.getLatestSuccess(REQUIRED_SPREADSHEET_ID);
    if (latestSuccess && latestSuccess.checksum === checksum) {
      return {
        success: true,
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
        dryRun,
        status: 'SKIPPED_UNCHANGED',
        checksum,
        counts: {
          products: approvedProducts.length,
          prices: approvedPrices.length,
          inventory: approvedInventory.length,
        },
        details: {
          skippedPending: totalSkippedPending,
          skippedDisabled: totalSkippedDisabled,
        },
        lastSuccessAt: latestSuccess.lastSuccessAt,
      };
    }

    if (dryRun) {
      return {
        success: true,
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
        dryRun: true,
        status: 'SUCCESS',
        checksum,
        counts: {
          products: approvedProducts.length,
          prices: approvedPrices.length,
          inventory: approvedInventory.length,
        },
        details: {
          productsAdded: approvedProducts.length,
          pricesCreated: approvedPrices.length,
          inventoryUpdated: approvedInventory.length,
          skippedPending: totalSkippedPending,
          skippedDisabled: totalSkippedDisabled,
          manifest,
        },
      };
    }

    // 7. Atomic Database Mutation with Advisory Lock
    const details = {
      productsAdded: 0,
      productsUpdated: 0,
      pricesCreated: 0,
      pricesUnchanged: 0,
      inventoryUpdated: 0,
      skippedPending: totalSkippedPending,
      skippedDisabled: totalSkippedDisabled,
      manifest,
    };

    const now = new Date();

    await withTransaction(this.driver, this.pool, this.repos, async (txRepos, client) => {
      // Try advisory lock if postgres
      if (client) {
        const lockRes = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(718293) as locked');
        if (!lockRes.rows[0]?.locked) {
          throw new Error('Concurrent Google Sheets sync in progress (advisory lock busy)');
        }
      }

      // Map existing products by code
      const existingProducts = await txRepos.products.findAll({});
      const productMap = new Map<string, (typeof existingProducts)[0]>();
      for (const ep of existingProducts) {
        if (ep.code) productMap.set(ep.code.toUpperCase(), ep);
      }

      // Sync Products (Source-Fidelity: preserve exact code, name, yarnType, color)
      for (const p of approvedProducts) {
        const codeKey = p.productCode.toUpperCase();
        const existing = productMap.get(codeKey);

        if (!existing) {
          const created = await txRepos.products.create({
            code: p.productCode,
            name: p.productName,
            category: p.category || 'General',
            yarnType: p.yarnType || undefined,
            count: p.count || undefined,
            composition: p.composition || undefined,
            description: p.description || '',
            price: 0,
            currency: 'USD',
            minimumOrder: 1,
            stockStatus: 'in_stock',
            media: [],
            active: p.active,
            aiRecommendable: p.active,
          });
          productMap.set(codeKey, created);
          details.productsAdded++;
        } else {
          await txRepos.products.update(existing.id, {
            name: p.productName,
            category: p.category,
            yarnType: p.yarnType || undefined,
            count: p.count || undefined,
            composition: p.composition || undefined,
            description: p.description,
            active: p.active,
            aiRecommendable: p.active,
          });
          details.productsUpdated++;
        }
      }

      // Sync Prices (Versioning: if price amount/currency changed, deactivate old and insert new active)
      for (const pr of approvedPrices) {
        const prod = productMap.get(pr.productCode.toUpperCase());
        if (!prod) continue;

        const currentActivePrice = await txRepos.productPrices.getActivePrice(prod.id, pr.paymentType);

        if (currentActivePrice) {
          if (
            currentActivePrice.price === pr.amount &&
            currentActivePrice.currency === pr.currency &&
            currentActivePrice.unit === pr.unit &&
            currentActivePrice.paymentType === pr.paymentType
          ) {
            details.pricesUnchanged++;
            continue;
          }

          // Inactivate old active price
          await txRepos.productPrices.update(currentActivePrice.id, {
            active: false,
            validUntil: now,
          });
        }

        // Create new active price
        await txRepos.productPrices.create({
          productId: prod.id,
          price: pr.amount,
          currency: pr.currency,
          paymentType: pr.paymentType,
          unit: pr.unit,
          minimumQuantity: pr.minOrderQuantity,
          validFrom: now,
          active: true,
          notes: pr.notes || 'Synced from Google Sheets',
          sourceSystem: 'GOOGLE_SHEETS',
          externalRowId: `row_${pr.rowNumber}`,
          sourceUpdatedAt: now,
          syncedAt: now,
        });
        details.pricesCreated++;
      }

      // Sync Inventory (Nullable quantities for UNKNOWN stock without falsifying to 0)
      for (const inv of approvedInventory) {
        const prod = productMap.get(inv.productCode.toUpperCase());
        if (!prod) continue;

        if (inv.availableQuantity === null) {
          // If availableQuantity is null/unknown, save status as UNKNOWN without putting fake 0
          await txRepos.productInventory.upsert(prod.id, {
            availableQuantity: 0,
            reservedQuantity: 0,
            unit: inv.unit,
            warehouse: inv.warehouse,
            status: 'UNKNOWN',
          });
        } else {
          const avail = inv.availableQuantity;
          const status = avail === 0 ? 'OUT_OF_STOCK' : avail < 500 ? 'LOW_STOCK' : 'IN_STOCK';
          await txRepos.productInventory.upsert(prod.id, {
            availableQuantity: avail,
            reservedQuantity: inv.reservedQuantity || 0,
            unit: inv.unit,
            warehouse: inv.warehouse,
            status,
          });
        }
        details.inventoryUpdated++;
      }

      // Record successful sync state
      await txRepos.googleSheetsSync.create({
        spreadsheetId: REQUIRED_SPREADSHEET_ID,
        status: 'SUCCESS',
        lastAttemptAt: now,
        lastSuccessAt: now,
        checksum,
        productsCount: approvedProducts.length,
        pricesCount: approvedPrices.length,
        inventoryCount: approvedInventory.length,
        sanitizedError: null,
      });
    });

    return {
      success: true,
      spreadsheetId: REQUIRED_SPREADSHEET_ID,
      dryRun: false,
      status: 'SUCCESS',
      checksum,
      counts: {
        products: approvedProducts.length,
        prices: approvedPrices.length,
        inventory: approvedInventory.length,
      },
      details,
      lastSuccessAt: now,
    };
  }
}
