import type { Repositories } from '@limax/shared';
import crypto from 'crypto';
import type { EmbeddingProvider } from '../embeddings/types.js';

export interface KnowledgeAuditReport {
  totalApproved: number;
  healthyIndexed: number;
  missingChunks: number;
  staleHash: number;
  wrongDimension: number;
  wrongModel: number;
  requiresReindex: number;
  items: Array<{
    id: string;
    title: string;
    status: string;
    issue?: 'MISSING_CHUNKS' | 'STALE_HASH' | 'WRONG_DIMENSION' | 'WRONG_MODEL';
    chunkCount: number;
  }>;
}

export async function auditKnowledgeIndex(
  repos: Repositories,
  embeddingProvider?: EmbeddingProvider
): Promise<KnowledgeAuditReport> {
  const allApproved = await repos.knowledge.findAll({ status: 'APPROVED' });
  const targetModel = embeddingProvider?.modelName || 'text-embedding-3-small';

  const report: KnowledgeAuditReport = {
    totalApproved: allApproved.length,
    healthyIndexed: 0,
    missingChunks: 0,
    staleHash: 0,
    wrongDimension: 0,
    wrongModel: 0,
    requiresReindex: 0,
    items: [],
  };

  for (const item of allApproved) {
    const indexState = await repos.knowledge.getIndexState(item.id);
    const contentHash = crypto.createHash('sha256').update((item.content || '').trim()).digest('hex');

    if (indexState.chunkCount === 0) {
      report.missingChunks++;
      report.requiresReindex++;
      report.items.push({ id: item.id, title: item.title, status: item.status, issue: 'MISSING_CHUNKS', chunkCount: 0 });
      continue;
    }

    const hasStaleHash = indexState.contentHashes.some((h) => h !== contentHash);
    if (hasStaleHash) {
      report.staleHash++;
      report.requiresReindex++;
      report.items.push({ id: item.id, title: item.title, status: item.status, issue: 'STALE_HASH', chunkCount: indexState.chunkCount });
      continue;
    }

    const hasWrongDimension = indexState.dimensions.some((d) => d !== 1536);
    if (hasWrongDimension) {
      report.wrongDimension++;
      report.requiresReindex++;
      report.items.push({ id: item.id, title: item.title, status: item.status, issue: 'WRONG_DIMENSION', chunkCount: indexState.chunkCount });
      continue;
    }

    const hasWrongModel = indexState.models.some((m) => m !== targetModel && m !== 'mock-1536');
    if (hasWrongModel) {
      report.wrongModel++;
      report.requiresReindex++;
      report.items.push({ id: item.id, title: item.title, status: item.status, issue: 'WRONG_MODEL', chunkCount: indexState.chunkCount });
      continue;
    }

    report.healthyIndexed++;
    report.items.push({ id: item.id, title: item.title, status: item.status, chunkCount: indexState.chunkCount });
  }

  return report;
}
