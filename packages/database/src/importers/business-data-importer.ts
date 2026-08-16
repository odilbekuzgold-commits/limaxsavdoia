import fs from 'fs';
import path from 'path';
import type pg from 'pg';
import {
  ProductImportArraySchema,
  PriceImportArraySchema,
  InventoryImportArraySchema,
  BusinessKnowledgeImportArraySchema,
  type ProductImportData,
  type PriceImportData,
  type InventoryImportData,
  type KnowledgeImportData,
} from './business-data.schema.js';

export interface BusinessDataImportOptions {
  dryRun?: boolean;
  confirmStaging?: boolean;
  databaseUrl?: string;
  pool?: pg.Pool;
  productsPath?: string;
  pricesPath?: string;
  inventoryPath?: string;
  knowledgePath?: string;
}

export interface CategorySummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  rejected: number;
  errors: string[];
}

export interface BusinessDataImportResult {
  dryRun: boolean;
  success: boolean;
  products: CategorySummary;
  prices: CategorySummary;
  inventory: CategorySummary;
  knowledge: CategorySummary;
  globalErrors: string[];
}

export function validateDatabaseUrlForImport(url: string): void {
  try {
    const parsed = new URL(url);
    const dbName = parsed.pathname.replace(/^\//, '');
    if (!dbName.startsWith('limax_test') && !dbName.startsWith('limax_stage_')) {
      throw new Error(
        `[BUSINESS DATA IMPORTER FATAL] Target database "${dbName}" is forbidden. Database name MUST start with "limax_test" or "limax_stage_".`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('BUSINESS DATA IMPORTER FATAL')) {
      throw err;
    }
    throw new Error('[BUSINESS DATA IMPORTER FATAL] Invalid PostgreSQL connection URL provided.');
  }
}

export async function importBusinessData(
  options: BusinessDataImportOptions
): Promise<BusinessDataImportResult> {
  const {
    dryRun = true,
    confirmStaging = false,
    databaseUrl,
    pool: providedPool,
    productsPath,
    pricesPath,
    inventoryPath,
    knowledgePath,
  } = options;

  const result: BusinessDataImportResult = {
    dryRun,
    success: true,
    products: { total: 0, created: 0, updated: 0, skipped: 0, rejected: 0, errors: [] },
    prices: { total: 0, created: 0, updated: 0, skipped: 0, rejected: 0, errors: [] },
    inventory: { total: 0, created: 0, updated: 0, skipped: 0, rejected: 0, errors: [] },
    knowledge: { total: 0, created: 0, updated: 0, skipped: 0, rejected: 0, errors: [] },
    globalErrors: [],
  };

  // 1. Environment & Guard Checks
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[BUSINESS DATA IMPORTER FATAL] Direct business data import in production is strictly prohibited.');
  }

  if (!dryRun && !confirmStaging) {
    throw new Error('[BUSINESS DATA IMPORTER FATAL] Non-dry-run import requires explicit --confirm-staging flag.');
  }

  if (!dryRun) {
    const targetUrl = databaseUrl || process.env.LIMAX_TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!targetUrl && !providedPool) {
      throw new Error('[BUSINESS DATA IMPORTER FATAL] Explicit database connection URL or pool required for staging import.');
    }
    if (targetUrl) {
      validateDatabaseUrlForImport(targetUrl);
    }
  }

  // Helper for loading & parsing JSON files
  const loadFile = <T>(filePath?: string): T | null => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  };

  // 2. Load Datasets
  let rawProducts: unknown = loadFile(productsPath);
  let rawPrices: unknown = loadFile(pricesPath);
  let rawInventory: unknown = loadFile(inventoryPath);
  let rawKnowledge: unknown = loadFile(knowledgePath);

  let validProducts: ProductImportData[] = [];
  let validPrices: PriceImportData[] = [];
  let validInventory: InventoryImportData[] = [];
  let validKnowledge: KnowledgeImportData[] = [];

  // Parse Products
  if (rawProducts) {
    const parseRes = ProductImportArraySchema.safeParse(rawProducts);
    if (parseRes.success) {
      validProducts = parseRes.data;
      result.products.total = validProducts.length;
    } else {
      result.products.rejected = Array.isArray(rawProducts) ? rawProducts.length : 1;
      result.products.errors.push(...parseRes.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
      result.success = false;
    }
  }

  // Parse Prices
  if (rawPrices) {
    const parseRes = PriceImportArraySchema.safeParse(rawPrices);
    if (parseRes.success) {
      validPrices = parseRes.data;
      result.prices.total = validPrices.length;

      // Check for overlapping ACTIVE prices in import batch
      const activePriceCodes = new Set<string>();
      for (const p of validPrices) {
        if (p.status === 'ACTIVE') {
          if (activePriceCodes.has(p.productCode)) {
            result.prices.errors.push(`Duplicate active price specified for product code "${p.productCode}" in import batch`);
            result.success = false;
          } else {
            activePriceCodes.add(p.productCode);
          }
        }
      }
    } else {
      result.prices.rejected = Array.isArray(rawPrices) ? rawPrices.length : 1;
      result.prices.errors.push(...parseRes.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
      result.success = false;
    }
  }

  // Parse Inventory
  if (rawInventory) {
    const parseRes = InventoryImportArraySchema.safeParse(rawInventory);
    if (parseRes.success) {
      validInventory = parseRes.data;
      result.inventory.total = validInventory.length;
    } else {
      result.inventory.rejected = Array.isArray(rawInventory) ? rawInventory.length : 1;
      result.inventory.errors.push(...parseRes.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
      result.success = false;
    }
  }

  // Parse Knowledge Base
  if (rawKnowledge) {
    const parseRes = BusinessKnowledgeImportArraySchema.safeParse(rawKnowledge);
    if (parseRes.success) {
      validKnowledge = parseRes.data;
      result.knowledge.total = validKnowledge.length;
    } else {
      result.knowledge.rejected = Array.isArray(rawKnowledge) ? rawKnowledge.length : 1;
      result.knowledge.errors.push(...parseRes.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
      result.success = false;
    }
  }

  // Cross-reference Checks (Unresolved product references)
  const productCodesInBatch = new Set(validProducts.map((p) => p.code));

  for (const price of validPrices) {
    if (!productCodesInBatch.has(price.productCode) && dryRun) {
      // In dryRun, if product isn't in batch, mark warning/error if no DB is available
      result.prices.errors.push(`Unresolved product reference "${price.productCode}" for price record`);
    }
  }

  for (const inv of validInventory) {
    if (!productCodesInBatch.has(inv.productCode) && dryRun) {
      result.inventory.errors.push(`Unresolved product reference "${inv.productCode}" for inventory record`);
    }
  }

  if (dryRun || !result.success) {
    // Return Dry-Run Simulation Results
    if (result.success) {
      result.products.created = validProducts.length;
      result.prices.created = validPrices.length;
      result.inventory.created = validInventory.length;
      result.knowledge.created = validKnowledge.length;
    }
    return result;
  }

  // 3. Staging DB Execution inside Transaction
  let pool = providedPool;
  let createdLocalPool = false;

  if (!pool && databaseUrl) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
    createdLocalPool = true;
  }

  if (!pool) {
    throw new Error('[BUSINESS DATA IMPORTER FATAL] No valid database pool available for staging import execution.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Maps product code -> product UUID
    const codeToIdMap = new Map<string, string>();

    // A. Upsert Products
    for (const prod of validProducts) {
      const existingRes = await client.query<{ id: string }>('SELECT id FROM products WHERE name = $1 LIMIT 1', [prod.name]);
      if (existingRes.rows.length > 0) {
        const id = existingRes.rows[0].id;
        await client.query(
          `UPDATE products SET description = $1, active = $2, updated_at = NOW() WHERE id = $3`,
          [prod.description || prod.name, prod.active, id]
        );
        codeToIdMap.set(prod.code, id);
        result.products.updated++;
      } else {
        const insertRes = await client.query<{ id: string }>(
          `INSERT INTO products (name, category, description, price, active, created_at, updated_at)
           VALUES ($1, $2, $3, 1.00, $4, NOW(), NOW()) RETURNING id`,
          [prod.name, prod.category || 'General', prod.description || prod.name, prod.active]
        );
        const id = insertRes.rows[0].id;
        codeToIdMap.set(prod.code, id);
        result.products.created++;
      }
    }

    // B. Upsert Prices
    for (const pr of validPrices) {
      let productId = codeToIdMap.get(pr.productCode);
      if (!productId) {
        const dbProdRes = await client.query<{ id: string }>('SELECT id FROM products WHERE name = $1 LIMIT 1', [pr.productCode]);
        if (dbProdRes.rows.length > 0) {
          productId = dbProdRes.rows[0].id;
        }
      }

      if (!productId) {
        result.prices.rejected++;
        result.prices.errors.push(`Product code "${pr.productCode}" not found in database.`);
        continue;
      }

      // Deactivate previous active prices for this product if inserting new ACTIVE price
      if (pr.status === 'ACTIVE') {
        await client.query('UPDATE product_prices SET active = false WHERE product_id = $1', [productId]);
      }

      await client.query(
        `INSERT INTO product_prices (product_id, price, currency, unit, minimum_quantity, valid_from, valid_until, active, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [
          productId,
          pr.amount,
          pr.currency,
          pr.unit,
          pr.minQuantity,
          pr.validFrom,
          pr.validUntil || null,
          pr.status === 'ACTIVE',
          pr.notes || null,
        ]
      );
      result.prices.created++;
    }

    // C. Upsert Inventory
    for (const inv of validInventory) {
      let productId = codeToIdMap.get(inv.productCode);
      if (!productId) {
        const dbProdRes = await client.query<{ id: string }>('SELECT id FROM products WHERE name = $1 LIMIT 1', [inv.productCode]);
        if (dbProdRes.rows.length > 0) {
          productId = dbProdRes.rows[0].id;
        }
      }

      if (!productId) {
        result.inventory.rejected++;
        result.inventory.errors.push(`Product code "${inv.productCode}" not found in database for inventory.`);
        continue;
      }

      await client.query(
        `INSERT INTO product_inventory (product_id, available_quantity, reserved_quantity, unit, status, warehouse, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (product_id) DO UPDATE SET
           available_quantity = EXCLUDED.available_quantity,
           reserved_quantity = EXCLUDED.reserved_quantity,
           unit = EXCLUDED.unit,
           status = EXCLUDED.status,
           warehouse = EXCLUDED.warehouse,
           updated_at = NOW()`,
        [productId, inv.availableQuantity, inv.reservedQuantity, inv.unit, inv.status, inv.warehouse]
      );
      result.inventory.created++;
    }

    // D. Upsert Knowledge Items (Always force status = DRAFT)
    for (const k of validKnowledge) {
      const existingRes = await client.query<{ id: string }>('SELECT id FROM knowledge_items WHERE source = $1 LIMIT 1', [k.source]);
      if (existingRes.rows.length > 0) {
        await client.query(
          `UPDATE knowledge_items SET title = $1, content = $2, language = $3, status = 'DRAFT', updated_at = NOW() WHERE id = $4`,
          [k.title, k.content, k.language, existingRes.rows[0].id]
        );
        result.knowledge.updated++;
      } else {
        await client.query(
          `INSERT INTO knowledge_items (title, content, language, source, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'DRAFT', NOW(), NOW())`,
          [k.title, k.content, k.language, k.source]
        );
        result.knowledge.created++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    result.success = false;
    result.globalErrors.push(`[BUSINESS DATA IMPORTER TRANSACTION ERROR] ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    client.release();
    if (createdLocalPool && pool) {
      await pool.end();
    }
  }

  return result;
}
