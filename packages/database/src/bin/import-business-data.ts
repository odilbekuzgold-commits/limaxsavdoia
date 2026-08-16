#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { importBusinessData } from '../importers/business-data-importer.js';

function parseArgs(args: string[]) {
  const flags = {
    dryRun: true,
    confirmStaging: false,
    databaseUrl: '',
    directory: 'data/business',
    productsFile: '',
    pricesFile: '',
    inventoryFile: '',
    knowledgeFile: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-dry-run' || arg === '--execute') {
      flags.dryRun = false;
    } else if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--confirm-staging') {
      flags.confirmStaging = true;
    } else if (arg === '--database-url' && args[i + 1]) {
      flags.databaseUrl = args[++i];
    } else if (arg === '--directory' && args[i + 1]) {
      flags.directory = args[++i];
    } else if (arg === '--products' && args[i + 1]) {
      flags.productsFile = args[++i];
    } else if (arg === '--prices' && args[i + 1]) {
      flags.pricesFile = args[++i];
    } else if (arg === '--inventory' && args[i + 1]) {
      flags.inventoryFile = args[++i];
    } else if (arg === '--knowledge' && args[i + 1]) {
      flags.knowledgeFile = args[++i];
    }
  }

  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  const baseDir = path.resolve(process.cwd(), flags.directory);
  const productsPath = flags.productsFile || path.join(baseDir, 'products.json');
  const pricesPath = flags.pricesFile || path.join(baseDir, 'prices.json');
  const inventoryPath = flags.inventoryFile || path.join(baseDir, 'inventory.json');
  const knowledgePath = flags.knowledgeFile || path.join(baseDir, 'knowledge.json');

  console.log('=== LIMAX AI MANAGER: BUSINESS DATA IMPORTER ===');
  console.log(`Mode: ${flags.dryRun ? 'DRY-RUN (Simulation)' : 'STAGING EXECUTION'}`);
  console.log(`Directory: ${baseDir}`);

  try {
    const result = await importBusinessData({
      dryRun: flags.dryRun,
      confirmStaging: flags.confirmStaging,
      databaseUrl: flags.databaseUrl || process.env.LIMAX_TEST_DATABASE_URL || process.env.DATABASE_URL,
      productsPath: fs.existsSync(productsPath) ? productsPath : undefined,
      pricesPath: fs.existsSync(pricesPath) ? pricesPath : undefined,
      inventoryPath: fs.existsSync(inventoryPath) ? inventoryPath : undefined,
      knowledgePath: fs.existsSync(knowledgePath) ? knowledgePath : undefined,
    });

    console.log('\n--- IMPORT SUMMARY REPORT ---');
    console.log(`Status: ${result.success ? 'SUCCESS' : 'VALIDATION/EXECUTION ERROR'}`);
    console.log(`Products  : Total ${result.products.total} | Created ${result.products.created} | Rejected ${result.products.rejected}`);
    console.log(`Prices    : Total ${result.prices.total} | Created ${result.prices.created} | Rejected ${result.prices.rejected}`);
    console.log(`Inventory : Total ${result.inventory.total} | Created ${result.inventory.created} | Rejected ${result.inventory.rejected}`);
    console.log(`Knowledge : Total ${result.knowledge.total} | Created ${result.knowledge.created} | Rejected ${result.knowledge.rejected}`);

    if (result.products.errors.length > 0) {
      console.log('\n[Product Validation Errors]');
      result.products.errors.forEach((e) => console.log('  - ' + e));
    }
    if (result.prices.errors.length > 0) {
      console.log('\n[Price Validation Errors]');
      result.prices.errors.forEach((e) => console.log('  - ' + e));
    }
    if (result.inventory.errors.length > 0) {
      console.log('\n[Inventory Validation Errors]');
      result.inventory.errors.forEach((e) => console.log('  - ' + e));
    }
    if (result.knowledge.errors.length > 0) {
      console.log('\n[Knowledge Validation Errors]');
      result.knowledge.errors.forEach((e) => console.log('  - ' + e));
    }

    if (!result.success) {
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[FATAL ERROR]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
