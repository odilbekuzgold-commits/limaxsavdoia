import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getEnv, parseCorsOrigins } from '@limax/config';
import { createHttpLogger, logger } from '@limax/logger';
import { checkDatabaseHealth, closeDbPool, getDbPool, createRepositories } from '@limax/database';
import type { RepositoryDriver } from '@limax/database';
import { checkRedisHealth, closeRedis } from '@limax/redis';
import { checkStorageHealth } from '@limax/storage';
import { requireInternalApiToken } from './common/middleware/auth.js';

const env = getEnv();

const app = express();

app.disable('x-powered-by');

app.use(helmet());

const httpLogger = createHttpLogger('limax-api', env.LOG_LEVEL);
app.use(httpLogger);

app.use((req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.headers['x-request-id'] = reqId;
  res.setHeader('x-request-id', reqId);
  next();
});

const allowedOrigins = parseCorsOrigins(env.CORS_ORIGINS);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS policy: Origin not allowed'));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: env.REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: env.REQUEST_BODY_LIMIT }));

app.get('/health', (req: Request, res: Response) => {
  const requestId = (req.headers['x-request-id'] as string) || '';
  res.status(200).json({
    status: 'ok',
    service: 'limax-api',
    requestId,
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

app.get('/health/live', (req: Request, res: Response) => {
  const requestId = (req.headers['x-request-id'] as string) || '';
  res.status(200).json({
    status: 'ok',
    service: 'limax-api',
    requestId,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/ready', async (req: Request, res: Response) => {
  const requestId = (req.headers['x-request-id'] as string) || '';
  if (env.REPOSITORY_DRIVER === 'memory') {
    return res.status(200).json({
      status: 'ok',
      services: {
        memory: 'ok',
      },
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  const [pgHealth, redisHealth, minioHealth] = await Promise.all([
    checkDatabaseHealth(3000),
    checkRedisHealth(3000),
    checkStorageHealth(3000),
  ]);

  const allReady =
    pgHealth.status === 'ok' &&
    redisHealth.status === 'ok';

  const statusCode = allReady ? 200 : 503;

  res.status(statusCode).json({
    status: allReady ? 'ok' : 'unavailable',
    services: {
      postgresql: pgHealth.status,
      redis: redisHealth.status,
      minio: minioHealth.status,
    },
    requestId,
    timestamp: new Date().toISOString(),
  });
});

// Repository initialization
import { createCustomersRouter } from './modules/customers.js';
import { createConversationsRouter } from './modules/conversations.js';
import { createLeadsRouter } from './modules/leads.js';
import { createProductsRouter } from './modules/products.js';
import { createKnowledgeRouter } from './modules/knowledge.js';
import { createInventoryRouter } from './modules/inventory.js';
import { createPricingRouter } from './modules/pricing.js';
import { createCertificatesRouter } from './modules/certificates.js';
import { createMediaRouter } from './modules/media.js';
import { createSettingsRouter } from './modules/settings.js';
import { createDashboardRouter } from './modules/dashboard.js';
import { TelegramClient } from '@limax/channel-adapters';
import {
  createTelegramWebhookRouter,
  createTelegramStatusRouter,
  TelegramPollingRunner,
} from './modules/telegram/index.js';

import { loadBehaviorV2Config } from '@limax/ai-engine';

try {
  loadBehaviorV2Config();
  logger.info('[API] Behavior V2 configuration loaded successfully');
} catch (err: any) {
  logger.fatal({ err: err.message }, '[API FATAL] Behavior V2 configuration missing or invalid. Aborting startup.');
  process.exit(1);
}

const driver = env.REPOSITORY_DRIVER as RepositoryDriver;

// Production safety: memory driver is not allowed in production
if (driver === 'memory' && env.NODE_ENV === 'production') {
  logger.error('REPOSITORY_DRIVER=memory is not allowed in production. Use postgres.');
  process.exit(1);
}

const pool = driver === 'postgres' ? getDbPool() : undefined;
const repos = createRepositories(driver, pool);

logger.info(`[API] Repository driver: ${driver}`);

// Business API is private. Telegram webhooks and health endpoints are mounted separately.
app.use('/api/v1', requireInternalApiToken(env.INTERNAL_API_TOKEN));

// Telegram Integration Setup
let telegramClient: TelegramClient | undefined;
if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== 'CHANGE_ME') {
  telegramClient = new TelegramClient({
    botToken: env.TELEGRAM_BOT_TOKEN,
    // Must exceed Telegram's long-poll timeout and tolerate transient TLS/network delay.
    timeoutMs: Math.max(30000, (env.TELEGRAM_POLL_TIMEOUT_SECONDS + 10) * 1000),
  });
}

app.use('/api/v1/customers', createCustomersRouter(repos.customers));
app.use('/api/v1/conversations', createConversationsRouter(repos.conversations, repos.messages, repos.handoffs));
app.use('/api/v1/leads', createLeadsRouter(repos.leads));
app.use('/api/v1/products', createProductsRouter(repos.products));
app.use('/api/v1/knowledge', createKnowledgeRouter(repos.knowledge));
app.use('/api/v1/inventory', createInventoryRouter(repos));
app.use('/api/v1/pricing', createPricingRouter(repos));
app.use('/api/v1/certificates', createCertificatesRouter(repos));
app.use('/api/v1/media', createMediaRouter(repos));
app.use('/api/v1/settings', createSettingsRouter(repos));
app.use('/api/v1/dashboard', createDashboardRouter(repos));
app.use(
  '/api/v1/webhooks/telegram',
  createTelegramWebhookRouter(
    repos,
    telegramClient,
    env.TELEGRAM_WEBHOOK_SECRET,
    env.TELEGRAM_DEV_ALLOW_REGULAR_MESSAGES,
    env.TELEGRAM_MANAGER_CHAT_ID
  )
);
app.use(
  '/api/v1/integrations/telegram',
  createTelegramStatusRouter(
    repos,
    telegramClient,
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_BOT_USERNAME,
    env.TELEGRAM_UPDATE_MODE,
    env.TELEGRAM_WEBHOOK_URL,
    driver
  )
);

// Start Telegram Polling Runner if in polling mode and token is configured
if (telegramClient && env.TELEGRAM_UPDATE_MODE === 'polling') {
  const pollingRunner = new TelegramPollingRunner({
    client: telegramClient,
    repos,
    pollTimeoutSeconds: env.TELEGRAM_POLL_TIMEOUT_SECONDS,
    pollLimit: env.TELEGRAM_POLL_LIMIT,
    allowRegularMessages: env.TELEGRAM_DEV_ALLOW_REGULAR_MESSAGES,
    managerChatId: env.TELEGRAM_MANAGER_CHAT_ID,
  });
  pollingRunner.start().catch((err) => {
    logger.error({ err }, '[Telegram Polling] Polling startup error');
  });
}

app.use((req: Request, res: Response) => {
  const requestId = (req.headers['x-request-id'] as string) || '';
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route '${req.method} ${req.path}' not found`,
      requestId,
    },
  });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || '';
  logger.error({ err, requestId }, 'Unhandled request error');

  const errorObj = err instanceof Error ? err : new Error(String(err));
  const statusCode = (err as { status?: number; statusCode?: number }).status || (err as { status?: number; statusCode?: number }).statusCode || 500;
  const isCORS = errorObj.message?.includes('CORS policy');

  res.status(isCORS ? 403 : statusCode).json({
    error: {
      code: isCORS ? 'FORBIDDEN_ORIGIN' : 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production' && !isCORS
          ? 'Internal server error'
          : errorObj.message || 'Internal server error',
      requestId,
    },
  });
});

const server = app.listen(env.API_PORT, () => {
  logger.info(
    `[API] LImax API Server running on http://localhost:${env.API_PORT} (${env.NODE_ENV})`,
  );
});

async function handleShutdown(signal: string) {
  logger.info(`[API] Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    try {
      await Promise.all([closeDbPool(), closeRedis()]);
      logger.info('[API] Connections closed cleanly. Process exiting.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, '[API] Error during shutdown');
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.warn('[API] Forceful shutdown triggered after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
