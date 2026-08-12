import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type pg from 'pg';
import type { IKnowledgeRepository, CreateKnowledgeItem } from '@limax/shared';

export const KnowledgeImportItemSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  language: z.enum(['uz', 'uz-Latn', 'uz-Cyrl', 'ru', 'en', 'zh', 'tg', 'kk', 'ky']).default('uz'),
  status: z.literal('DRAFT').default('DRAFT'),
  source: z.string().min(1),
});

export const KnowledgeImportArraySchema = z.array(KnowledgeImportItemSchema);
export type KnowledgeImportItem = z.infer<typeof KnowledgeImportItemSchema>;

export interface KnowledgeImporterOptions {
  dryRun?: boolean;
  confirmStaging?: boolean;
  repo?: IKnowledgeRepository;
  pool?: pg.Pool;
}

export async function importKnowledgePackV2(
  filePath: string,
  options: KnowledgeImporterOptions
): Promise<{ total: number; created: number; skipped: number; failed: number; dryRun: boolean }> {
  const { dryRun = false, confirmStaging = false, repo, pool } = options;

  // Environment protection
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[KNOWLEDGE IMPORTER FATAL] Direct import in production environment is strictly prohibited.');
  }

  if (!dryRun && !confirmStaging) {
    throw new Error('[KNOWLEDGE IMPORTER FATAL] Non-dry-run import requires explicit --confirm-staging flag.');
  }

  if (!dryRun && !repo && !pool) {
    throw new Error('[KNOWLEDGE IMPORTER FATAL] Explicit target repository or database pool required for non-dry-run import.');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`[KNOWLEDGE IMPORTER FATAL] Knowledge file not found: ${filePath}`);
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(rawContent);
  const validatedItems = KnowledgeImportArraySchema.parse(parsed);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  if (dryRun) {
    // Dry run simulation
    const existingSources = new Set<string>();
    for (const item of validatedItems) {
      if (existingSources.has(item.source)) {
        skipped++;
      } else {
        existingSources.add(item.source);
        created++;
      }
    }
    return {
      total: validatedItems.length,
      created,
      skipped,
      failed,
      dryRun: true,
    };
  }

  // Real Staging Import with SQL Transaction support if Pool is passed
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: existingRows } = await client.query<{ source: string }>('SELECT source FROM knowledge_base WHERE source IS NOT NULL');
      const existingSources = new Set(existingRows.map((r) => r.source));

      for (const item of validatedItems) {
        if (existingSources.has(item.source)) {
          skipped++;
          continue;
        }

        const now = new Date();
        await client.query(
          `INSERT INTO knowledge_base (id, title, content, category, tags, language, source, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'textile', ARRAY[]::text[], $3, $4, 'DRAFT', $5, $5)`,
          [item.title, item.content, item.language, item.source, now]
        );
        existingSources.add(item.source);
        created++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      failed = validatedItems.length - skipped - created;
      throw new Error(`[KNOWLEDGE IMPORTER TRANSACTION ERROR] ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  } else if (repo) {
    const existingItems = await repo.findAll({});
    const existingSources = new Set(existingItems.map((i) => i.source).filter(Boolean));

    for (const item of validatedItems) {
      if (item.source && existingSources.has(item.source)) {
        skipped++;
        continue;
      }

      const createPayload: CreateKnowledgeItem = {
        title: item.title,
        content: item.content,
        language: item.language,
        status: 'DRAFT', // Always force DRAFT
        source: item.source,
      };

      await repo.create(createPayload);
      if (item.source) existingSources.add(item.source);
      created++;
    }
  }

  return {
    total: validatedItems.length,
    created,
    skipped,
    failed,
    dryRun: false,
  };
}
