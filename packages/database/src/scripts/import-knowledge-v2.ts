import path from 'path';
import pg from 'pg';
import { importKnowledgePackV2 } from '../importers/knowledge-import.js';

async function runCli() {
  const args = process.argv.slice(2);
  
  const dryRun = args.includes('--dry-run');
  const confirmStaging = args.includes('--confirm-staging');
  
  let customFilePath: string | undefined;
  const fileArgIndex = args.indexOf('--file');
  if (fileArgIndex !== -1 && args[fileArgIndex + 1]) {
    customFilePath = args[fileArgIndex + 1];
  }

  let dbUrl: string | undefined;
  const dbArgIndex = args.indexOf('--database-url');
  if (dbArgIndex !== -1 && args[dbArgIndex + 1]) {
    dbUrl = args[dbArgIndex + 1];
  } else {
    dbUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
  }

  const filePath = customFilePath || path.join(process.cwd(), 'data', 'knowledge', 'conversation-pack.v2.json');

  console.log('=== LIMAX CONVERSATION PACK V2 KNOWLEDGE IMPORTER CLI ===');
  console.log(`Target file: ${filePath}`);
  console.log(`Dry run mode: ${dryRun}`);
  console.log(`Staging confirmed: ${confirmStaging}`);

  if (process.env.NODE_ENV === 'production') {
    console.error('\n[FATAL] Direct import in production environment is strictly forbidden.');
    process.exit(1);
  }

  if (!dryRun && !confirmStaging) {
    console.error('\n[FATAL] Non-dry-run real staging import requires explicit --confirm-staging flag.');
    process.exit(1);
  }

  let pool: pg.Pool | undefined;
  if (!dryRun) {
    if (!dbUrl) {
      console.error('\n[FATAL] Database connection URL is missing. Provide --database-url or set STAGING_DATABASE_URL.');
      process.exit(1);
    }
    // Sanitize log output: never display passwords or secrets
    const redactedUrl = dbUrl.replace(/(:[^:@]+@)/, ':****@');
    console.log(`Database connection: ${redactedUrl}`);
    pool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  }

  try {
    const result = await importKnowledgePackV2(filePath, {
      dryRun,
      confirmStaging,
      pool,
    });

    console.log('\n=== IMPORT RESULT SUMMARY ===');
    console.log(`Total items in file: ${result.total}`);
    console.log(`Created (DRAFT status): ${result.created}`);
    console.log(`Skipped (Duplicates): ${result.skipped}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Dry run mode: ${result.dryRun}`);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

runCli().catch((err) => {
  console.error('\n[CLI FATAL ERROR]', err.message);
  process.exit(1);
});
