import path from 'path';
import { importKnowledgePackV2 } from '../importers/knowledge-import.js';

async function runCli() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePath = path.join(process.cwd(), 'data', 'knowledge', 'conversation-pack.v2.json');

  console.log('=== LIMAX CONVERSATION PACK V2 KNOWLEDGE IMPORTER ===');
  console.log(`Target file: ${filePath}`);
  console.log(`Dry run mode: ${dryRun}`);

  if (!dryRun) {
    console.error('\n[FATAL] Real database import requires explicit DB connection configuration. Use --dry-run for simulation.');
    process.exit(1);
  }

  const result = await importKnowledgePackV2(filePath, { dryRun: true });
  console.log('\n=== IMPORT SIMULATION RESULT ===');
  console.log(`Total items parsed: ${result.total}`);
  console.log(`Simulated creations (DRAFT status): ${result.created}`);
  console.log(`Skipped duplicates: ${result.skipped}`);
  console.log(`Dry run: ${result.dryRun}`);
}

runCli().catch((err) => {
  console.error('[IMPORT ERROR]', err.message);
  process.exit(1);
});
