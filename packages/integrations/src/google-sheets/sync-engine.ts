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

export interface SyncOptions {
  dryRun?: boolean;
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
  ): { valid: T[]; errors: string[] } {
    if (!rawRows || rawRows.length <= 1) {
      return { valid: [], errors: [] };
    }

    const headers = rawRows[0].map((h) => h.trim().toLowerCase());
    const map: Record<string, number> = {};
    for (const [key, fallbackIdx] of Object.entries(fieldMapping)) {
      const foundIdx = headers.findIndex((h) => h.includes(key.toLowerCase()));
      map[key] = foundIdx >= 0 ? foundIdx : fallbackIdx;
    }

    const valid: T[] = [];
    const errors: string[] = [];

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.every((c) => !c || c.trim() === '')) continue; // skip empty rows

      const rowObj: Record<string, unknown> = { rowNumber: i + 1 };
      for (const [key, colIdx] of Object.entries(map)) {
        rowObj[key] = row[colIdx] !== undefined ? row[colIdx].trim() : '';
      }

      try {
        const parsed = schema.parse(rowObj);
        valid.push(parsed);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${i + 1}: ${msg}`);
      }
    }

    return { valid, errors };
  }

  async runSync(options: SyncOptions = {}): Promise<SyncResult> {
    const dryRun = Boolean(options.dryRun);

    // 1. Read all 4 tabs from Google Sheets
    const rawTabs = await this.client.readAllTabs();

    // 2. Parse Products Tab
    const productFieldMap = {
      productCode: 0,
      productName: 1,
      category: 2,
      description: 3,
      unit: 4,
      active: 5,
      approvalStatus: 6,
      syncEnabled: 7,
      notes: 8,
    };
    const parsedProducts = this.parseRows<SheetProductRow>(rawTabs.products, SheetProductRowSchema, productFieldMap);

    // 3. Parse Prices Tab
    const priceFieldMap = {
      productCode: 0,
      paymentType: 1,
      amount: 2,
      currency: 3,
      unit: 4,
      minOrderQuantity: 5,
      approvalStatus: 6,
      syncEnabled: 7,
      notes: 8,
    };
    const parsedPrices = this.parseRows<SheetPriceRow>(rawTabs.prices, SheetPriceRowSchema, priceFieldMap);

    // 4. Parse Inventory Tab
    const inventoryFieldMap = {
      productCode: 0,
      availableQuantity: 1,
      reservedQuantity: 2,
      unit: 3,
      warehouse: 4,
      approvalStatus: 5,
      syncEnabled: 6,
      notes: 7,
    };
    const parsedInventory = this.parseRows<SheetInventoryRow>(rawTabs.inventory, SheetInventoryRowSchema, inventoryFieldMap);

    const allErrors = [
      ...parsedProducts.errors,
      ...parsedPrices.errors,
      ...parsedInventory.errors,
    ];

    // Filter only APPROVED and syncEnabled = true
    const approvedProducts = parsedProducts.valid.filter((p) => p.approvalStatus === 'APPROVED' && p.syncEnabled);
    const approvedPrices = parsedPrices.valid.filter((p) => p.approvalStatus === 'APPROVED' && p.syncEnabled);
    const approvedInventory = parsedInventory.valid.filter((p) => p.approvalStatus === 'APPROVED' && p.syncEnabled);

    // Duplicate productCode validation
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
        errors: allErrors,
      };
    }

    // 5. Calculate Checksum
    const payloadForChecksum = JSON.stringify({
      products: approvedProducts.map((p) => ({ code: p.productCode, name: p.productName, active: p.active, category: p.category })),
      prices: approvedPrices.map((pr) => ({ code: pr.productCode, type: pr.paymentType, amount: pr.amount, currency: pr.currency })),
      inventory: approvedInventory.map((inv) => ({ code: inv.productCode, avail: inv.availableQuantity, res: inv.reservedQuantity })),
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
        },
      };
    }

    // 7. Atomic Database Mutation with Advisory Lock
    let details = {
      productsAdded: 0,
      productsUpdated: 0,
      pricesCreated: 0,
      pricesUnchanged: 0,
      inventoryUpdated: 0,
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

      // Sync Products
      for (const p of approvedProducts) {
        const codeKey = p.productCode.toUpperCase();
        const existing = productMap.get(codeKey);

        if (!existing) {
          const created = await txRepos.products.create({
            code: p.productCode,
            name: p.productName,
            category: p.category || 'General',
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

      // Sync Inventory
      for (const inv of approvedInventory) {
        const prod = productMap.get(inv.productCode.toUpperCase());
        if (!prod) continue;

        const status = inv.availableQuantity === 0 ? 'OUT_OF_STOCK' : inv.availableQuantity < 500 ? 'LOW_STOCK' : 'IN_STOCK';

        await txRepos.productInventory.upsert(prod.id, {
          availableQuantity: inv.availableQuantity,
          reservedQuantity: inv.reservedQuantity,
          unit: inv.unit,
          warehouse: inv.warehouse,
          status,
        });
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
