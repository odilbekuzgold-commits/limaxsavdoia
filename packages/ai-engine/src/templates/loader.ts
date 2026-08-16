import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DictionaryItem, RouterCompactItem, TemplateQAItem } from './types.js';

export interface LoadedTemplateDataset {
  dictionary: DictionaryItem[];
  routerCompact: RouterCompactItem[];
  templateQA: TemplateQAItem[];
}

let cachedDataset: LoadedTemplateDataset | null = null;

function resolveDatasetFilePath(filename: string): string {
  let currentDir = '';
  try {
    const __filename = fileURLToPath(import.meta.url);
    currentDir = path.dirname(__filename);
  } catch {
    currentDir = process.cwd();
  }

  const candidatePaths = [
    path.resolve(currentDir, `./dataset/${filename}`),
    path.resolve(process.cwd(), `packages/ai-engine/src/templates/dataset/${filename}`),
    path.resolve(process.cwd(), `dist/templates/dataset/${filename}`),
    path.resolve(process.cwd(), `src/templates/dataset/${filename}`),
    path.resolve(`C:/Users/hp/Documents/Codex/2026-08-13/files-mentioned-by-the-user-limax/outputs/${filename}`),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error(`[TemplateLoader FATAL] Dataset file not found: ${filename}`);
}

export function loadTemplateDataset(): LoadedTemplateDataset {
  if (cachedDataset) return cachedDataset;

  const dictPath = resolveDatasetFilePath('04_CUSTOMER_LANGUAGE_DICTIONARY.json');
  const routerCompactPath = resolveDatasetFilePath('09_TEMPLATE_ROUTER_COMPACT.json');
  const templateQAPath = resolveDatasetFilePath('03_TEMPLATE_QA_FINAL.json');

  const dictionary = JSON.parse(fs.readFileSync(dictPath, 'utf8')) as DictionaryItem[];
  const routerCompact = JSON.parse(fs.readFileSync(routerCompactPath, 'utf8')) as RouterCompactItem[];
  const qaParsed = JSON.parse(fs.readFileSync(templateQAPath, 'utf8')) as { templates: TemplateQAItem[] };

  cachedDataset = {
    dictionary,
    routerCompact,
    templateQA: qaParsed.templates || [],
  };

  return cachedDataset;
}

export function resetTemplateDatasetCache(): void {
  cachedDataset = null;
}
