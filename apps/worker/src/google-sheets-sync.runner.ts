import type { RepositoryDriver } from '@limax/database';
import type { Repositories } from '@limax/shared';
import {
  GoogleSheetsClient,
  GoogleSheetsSyncEngine,
  REQUIRED_SPREADSHEET_ID,
} from '@limax/integrations';
import { logger } from '@limax/logger';

export interface GoogleSheetsWorkerConfig {
  enabled: boolean;
  intervalSeconds: number;
  spreadsheetId?: string;
  serviceAccountEmail?: string;
  privateKey?: string;
}

export class GoogleSheetsSyncRunner {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    private repos: Repositories,
    private config: GoogleSheetsWorkerConfig,
    private driver: RepositoryDriver = 'postgres',
    private pool?: any
  ) {}

  start(): void {
    if (!this.config.enabled) {
      logger.info('[Google Sheets Sync Worker] Disabled by configuration (GOOGLE_SHEETS_SYNC_ENABLED=false)');
      return;
    }

    const intervalMs = (this.config.intervalSeconds || 300) * 1000;
    logger.info(`[Google Sheets Sync Worker] Starting runner (interval: ${this.config.intervalSeconds}s)...`);

    // Immediate initial sync
    this.runOnce().catch((err) => {
      logger.error('[Google Sheets Sync Worker] Initial sync failed:', err);
    });

    this.timer = setInterval(() => {
      this.runOnce().catch((err) => {
        logger.error('[Google Sheets Sync Worker] Periodic sync failed:', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[Google Sheets Sync Worker] Runner stopped');
    }
  }

  async runOnce(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[Google Sheets Sync Worker] Sync already running, skipping turn');
      return;
    }

    this.isRunning = true;
    try {
      const spreadsheetId = this.config.spreadsheetId || REQUIRED_SPREADSHEET_ID;
      const client = new GoogleSheetsClient({
        spreadsheetId,
        serviceAccountEmail: this.config.serviceAccountEmail,
        privateKey: this.config.privateKey,
      });

      const engine = new GoogleSheetsSyncEngine(client, this.repos, this.driver, this.pool);
      const res = await engine.runSync({ dryRun: false });

      if (res.status === 'SKIPPED_UNCHANGED') {
        logger.info(`[Google Sheets Sync Worker] Checksum match (${res.checksum.substring(0, 8)}), DB mutation skipped`);
      } else if (res.success) {
        logger.info(`[Google Sheets Sync Worker] Sync SUCCESS: ${res.counts.products} products, ${res.counts.prices} prices, ${res.counts.inventory} inventory rows`);
      } else {
        logger.error(`[Google Sheets Sync Worker] Sync FAILED: ${res.errors?.join('; ')}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Google Sheets Sync Worker] Execution error: ${msg}`);
    } finally {
      this.isRunning = false;
    }
  }
}
