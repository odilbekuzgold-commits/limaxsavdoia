import { randomUUID } from 'node:crypto';
import type {
  GoogleSheetsSyncState,
  IGoogleSheetsSyncRepository,
} from '@limax/shared';

export class InMemoryGoogleSheetsSyncRepository implements IGoogleSheetsSyncRepository {
  private states: GoogleSheetsSyncState[] = [];

  async create(data: Omit<GoogleSheetsSyncState, 'id' | 'createdAt' | 'updatedAt'>): Promise<GoogleSheetsSyncState> {
    const now = new Date();
    const state: GoogleSheetsSyncState = {
      id: randomUUID(),
      spreadsheetId: data.spreadsheetId,
      status: data.status,
      lastAttemptAt: data.lastAttemptAt || now,
      lastSuccessAt: data.lastSuccessAt || null,
      checksum: data.checksum || null,
      productsCount: data.productsCount || 0,
      pricesCount: data.pricesCount || 0,
      inventoryCount: data.inventoryCount || 0,
      sanitizedError: data.sanitizedError || null,
      createdAt: now,
      updatedAt: now,
    };
    this.states.push(state);
    return state;
  }

  async getLatest(spreadsheetId?: string): Promise<GoogleSheetsSyncState | null> {
    const filtered = spreadsheetId
      ? this.states.filter((s) => s.spreadsheetId === spreadsheetId)
      : this.states;
    if (filtered.length === 0) return null;
    return [...filtered].sort((a, b) => b.lastAttemptAt.getTime() - a.lastAttemptAt.getTime())[0] || null;
  }

  async getLatestSuccess(spreadsheetId?: string): Promise<GoogleSheetsSyncState | null> {
    const filtered = this.states
      .filter((s) => s.status === 'SUCCESS' && (!spreadsheetId || s.spreadsheetId === spreadsheetId));
    if (filtered.length === 0) return null;
    return [...filtered].sort((a, b) => (b.lastSuccessAt?.getTime() || 0) - (a.lastSuccessAt?.getTime() || 0))[0] || null;
  }
}
