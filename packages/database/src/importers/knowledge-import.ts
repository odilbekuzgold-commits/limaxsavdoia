import fs from 'fs';
import path from 'path';
import { z } from 'zod';
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
  repo?: IKnowledgeRepository;
}

export async function importKnowledgePackV2(
  filePath: string,
  options: KnowledgeImporterOptions
): Promise<{ total: number; created: number; skipped: number; dryRun: boolean }> {
  const { dryRun = false, repo } = options;

  if (!dryRun && !repo) {
    throw new Error('[KNOWLEDGE IMPORTER FATAL] Target repository is missing. Explicit repository or database connection required for non-dry-run import.');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`[KNOWLEDGE IMPORTER FATAL] File not found: ${filePath}`);
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(rawContent);
  const validatedItems = KnowledgeImportArraySchema.parse(parsed);

  let created = 0;
  let skipped = 0;

  let existingItemsSourceMap = new Set<string>();
  if (repo && !dryRun) {
    const existing = await repo.findAll({});
    existing.forEach((item) => {
      if (item.source) {
        existingItemsSourceMap.add(item.source);
      }
    });
  }

  for (const item of validatedItems) {
    // Force DRAFT status regardless of input
    const createPayload: CreateKnowledgeItem = {
      title: item.title,
      content: item.content,
      language: item.language,
      status: 'DRAFT', // Always DRAFT
      source: item.source,
    };

    if (existingItemsSourceMap.has(item.source)) {
      skipped++;
      continue;
    }

    if (!dryRun && repo) {
      await repo.create(createPayload);
      existingItemsSourceMap.add(item.source);
      created++;
    } else {
      // Dry run simulation
      created++;
    }
  }

  return {
    total: validatedItems.length,
    created,
    skipped,
    dryRun,
  };
}
