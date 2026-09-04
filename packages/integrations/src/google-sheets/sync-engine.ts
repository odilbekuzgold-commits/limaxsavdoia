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
  SheetKnowledgeRowSchema,
  type SheetProductRow,
  type SheetPriceRow,
  type SheetInventoryRow,
  type SheetKnowledgeRow,
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
    knowledge?: number;
  };
  details?: {
    productsAdded?: number;
    productsUpdated?: number;
    pricesCreated?: number;
    pricesUnchanged?: number;
    inventoryUpdated?: number;
    knowledgeAdded?: number;
    knowledgeUpdated?: number;
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
    const hasHeaders = normHeaders.some((h) => h.includes('code') || h.includes('status') || h.includes('name') || h.includes('title') || h.includes('savol') || h.includes('content') || h.includes('matn'));

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
      if (normKey === 'title') {
        const idx = normHeaders.findIndex((h) => h.includes('title') || h.includes('savol') || h.includes('mavzu') || h.includes('question') || h.includes('topic') || h.includes('nomi') || h.includes('sarlavha'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'content') {
        const idx = normHeaders.findIndex((h) => h.includes('content') || h.includes('matn') || h.includes('javob') || h.includes('answer') || h.includes('text') || h.includes('description') || h.includes('izoh') || h.includes('malumot'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'category') {
        const idx = normHeaders.findIndex((h) => h.includes('category') || h.includes('kategoriya') || h.includes('bolim') || h.includes('section'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'language') {
        const idx = normHeaders.findIndex((h) => h.includes('lang') || h.includes('til'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'approvalstatus') {
        const idx = normHeaders.findIndex((h) => h.includes('status') || h.includes('tasdiq') || h.includes('holat'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'syncenabled') {
        const idx = normHeaders.findIndex((h) => h.includes('sync') || h.includes('faol') || h.includes('active') || h.includes('sinxronlash'));
        if (idx >= 0) return idx;
      }
      if (normKey === 'source') {
        const idx = normHeaders.findIndex((h) => h.includes('source') || h.includes('manba'));
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

    // 5. Parse Knowledge Tab (Bilimlar_Bazasi, Knowledge, or FAQ)
    let rawKnowledge: string[][] = [];
    let knowledgeTabFound = false;

    const isKnowledgeHeader = (rows?: string[][]): boolean => {
      if (!rows || rows.length <= 1) return false;
      const headerStr = rows[0].map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')).join(' ');
      if (headerStr.includes('priceinventorycontrol') || headerStr.includes('narxyozuvlari') || headerStr.includes('productcode')) {
        return false;
      }
      const hasTitle = rows[0].some((h) => {
        const n = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        return n.includes('title') || n.includes('savol') || n.includes('mavzu') || n.includes('sarlavha') || n.includes('question') || n.includes('nomi');
      });
      const hasContent = rows[0].some((h) => {
        const n = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        return n.includes('content') || n.includes('matn') || n.includes('javob') || n.includes('izoh') || n.includes('answer') || n.includes('malumot');
      });
      return hasTitle && hasContent;
    };

    for (const tabName of ['Bilimlar_Bazasi', 'Knowledge', 'FAQ']) {
      try {
        const rows = await this.client.readTab(tabName);
        if (isKnowledgeHeader(rows)) {
          rawKnowledge = rows;
          knowledgeTabFound = true;
          break;
        }
      } catch {
        // Tab not found or error reading optional tab
      }
    }

    const knowledgeParsed = knowledgeTabFound
      ? this.parseRows<SheetKnowledgeRow>(
          rawKnowledge,
          SheetKnowledgeRowSchema,
          {
            title: 0,
            content: 1,
            category: 2,
            language: 3,
            approvalStatus: 4,
            syncEnabled: 5,
            source: 6,
          }
        )
      : { valid: [], errors: [], skippedPending: 0, skippedDisabled: 0 };

    const approvedKnowledge = knowledgeParsed.valid.filter((k) => k.approvalStatus === 'APPROVED' && k.syncEnabled);

    const allErrors = [
      ...productParsed.errors,
      ...priceParsed.errors,
      ...inventoryParsed.errors,
      ...knowledgeParsed.errors,
    ];

    const totalSkippedPending = productParsed.skippedPending + priceParsed.skippedPending + inventoryParsed.skippedPending + knowledgeParsed.skippedPending;
    const totalSkippedDisabled = productParsed.skippedDisabled + priceParsed.skippedDisabled + inventoryParsed.skippedDisabled + knowledgeParsed.skippedDisabled;

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
      knowledge: approvedKnowledge.map((k) => ({
        title: k.title,
        content: k.content,
        lang: k.language,
        cat: k.category,
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
          knowledge: approvedKnowledge.length,
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
          knowledge: approvedKnowledge.length,
        },
        details: {
          productsAdded: approvedProducts.length,
          pricesCreated: approvedPrices.length,
          inventoryUpdated: approvedInventory.length,
          knowledgeAdded: approvedKnowledge.length,
          knowledgeUpdated: 0,
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
      knowledgeAdded: 0,
      knowledgeUpdated: 0,
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

      // Sync Knowledge Base (Upsert into knowledge_items and ensure chunks)
      if (approvedKnowledge.length > 0 && txRepos.knowledge) {
        const existingKnowledge = await txRepos.knowledge.findAll({});
        const knowledgeMap = new Map<string, (typeof existingKnowledge)[0]>();
        for (const ek of existingKnowledge) {
          if (ek.title) knowledgeMap.set(ek.title.trim().toLowerCase(), ek);
        }

        for (const k of approvedKnowledge) {
          const titleKey = k.title.trim().toLowerCase();
          const existing = knowledgeMap.get(titleKey);

          if (!existing) {
            const created = await txRepos.knowledge.create({
              title: k.title.trim(),
              content: k.content.trim(),
              language: (k.language || 'uz') as any,
              status: k.approvalStatus === 'APPROVED' ? 'APPROVED' : 'DRAFT',
              source: k.source || 'GOOGLE_SHEETS',
            });
            await txRepos.knowledge.replaceChunks(created.id, [
              {
                chunkIndex: 0,
                content: k.content.trim(),
                language: (k.language || 'uz') as any,
                metadata: { title: k.title.trim(), category: k.category, source: 'GOOGLE_SHEETS' },
              },
            ]);
            details.knowledgeAdded = (details.knowledgeAdded || 0) + 1;
          } else {
            await txRepos.knowledge.update(existing.id, {
              title: k.title.trim(),
              content: k.content.trim(),
              language: (k.language || 'uz') as any,
              status: k.approvalStatus === 'APPROVED' ? 'APPROVED' : 'DRAFT',
              source: k.source || 'GOOGLE_SHEETS',
              approvedBy: '00000000-0000-0000-0000-000000000001',
              approvedAt: now,
            });
            await txRepos.knowledge.replaceChunks(existing.id, [
              {
                chunkIndex: 0,
                content: k.content.trim(),
                language: (k.language || 'uz') as any,
                metadata: { title: k.title.trim(), category: k.category, source: 'GOOGLE_SHEETS' },
              },
            ]);
            details.knowledgeUpdated = (details.knowledgeUpdated || 0) + 1;
          }
        }
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
        knowledge: approvedKnowledge.length,
      },
      details,
      lastSuccessAt: now,
    };
  }
}
