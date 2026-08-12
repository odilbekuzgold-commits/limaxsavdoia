import { getEnv } from '@limax/config';
import { createLogger } from '@limax/logger';
import { closeDbPool } from '@limax/database';
import { closeRedis } from '@limax/redis';
import { createBlockingConsumer, type QueueJob } from '@limax/queue';

const env = getEnv();
const logger = createLogger('limax-worker', env.LOG_LEVEL);

let stopping = false;
let consumer: Awaited<ReturnType<typeof createBlockingConsumer>> | null = null;

async function processJob(job: QueueJob): Promise<void> {
  switch (job.type) {
    case 'healthcheck':
      logger.info({ jobId: job.id }, '[Worker] Healthcheck job processed');
      return;
    default:
      logger.warn({ jobId: job.id, jobType: job.type }, '[Worker] Unsupported job sent to dead-letter log');
  }
}

import { loadBehaviorV2Config } from '@limax/ai-engine';

async function run(): Promise<void> {
  try {
    loadBehaviorV2Config();
    logger.info('[Worker] Behavior V2 configuration loaded successfully');
  } catch (err: any) {
    logger.fatal({ err: err.message }, '[Worker FATAL] Behavior V2 configuration missing or invalid. Aborting startup.');
    process.exit(1);
  }

  consumer = await createBlockingConsumer();
  logger.info(`[Worker] Redis queue consumer started (${env.NODE_ENV})`);
  let failures = 0;

  while (!stopping) {
    try {
      const job = await consumer.next(5);
      if (job) await processJob(job);
      failures = 0;
    } catch (err) {
      if (stopping) break;
      failures += 1;
      const delayMs = Math.min(500 * 2 ** failures, 10_000);
      logger.error({ err, delayMs }, '[Worker] Queue error; retrying');
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function handleWorkerShutdown(signal: string) {
  logger.info(`[Worker] Received ${signal}. Starting graceful shutdown...`);
  stopping = true;
  try {
    await consumer?.close();
    await Promise.all([closeDbPool(), closeRedis()]);
    logger.info('[Worker] All connections closed cleanly. Exiting.');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '[Worker] Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => handleWorkerShutdown('SIGINT'));
process.on('SIGTERM', () => handleWorkerShutdown('SIGTERM'));

run().catch((err) => {
  logger.fatal({ err }, '[Worker] Failed to start queue consumer');
  process.exit(1);
});
