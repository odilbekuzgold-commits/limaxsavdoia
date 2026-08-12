import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REPOSITORY_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  API_PORT: z.coerce.number().default(4000),
  WORKER_PORT: z.coerce.number().default(4001),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default('postgresql://limax_user:LimaxManager1122@localhost:5432/limax_db'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').default('redis://localhost:6379'),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),
  MINIO_ACCESS_KEY: z.string().default('limax_minio_admin'),
  MINIO_SECRET_KEY: z.string().default('LimaxManager1122'),
  MINIO_BUCKET_NAME: z.string().default('limax-media'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  REQUEST_BODY_LIMIT: z.string().default('2mb'),
  INTERNAL_API_TOKEN: z.string().min(32).optional(),
  DASHBOARD_API_URL: z.string().url().default('http://api:4000'),
  DASHBOARD_USER: z.string().min(1).optional(),
  DASHBOARD_PASSWORD: z.string().min(12).optional(),
  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_UPDATE_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_POLL_TIMEOUT_SECONDS: z.coerce.number().default(30),
  TELEGRAM_POLL_LIMIT: z.coerce.number().default(50),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_DEV_ALLOW_REGULAR_MESSAGES: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(true),
  TELEGRAM_MANAGER_CHAT_ID: z.string().optional(),
  TELEGRAM_PER_CHAT_RATE_LIMIT: z.coerce.number().default(10),
  TELEGRAM_MESSAGE_DEBOUNCE_MS: z.coerce.number().default(750),

  // Stage 5: AI & RAG Configuration
  AI_MODE: z.enum(['mock', 'real']).default('mock'),
  AI_PRIMARY_PROVIDER: z.enum(['openai', 'gemini', 'claude', 'mock']).default('openai'),
  AI_FALLBACK_PROVIDER: z.enum(['openai', 'gemini', 'claude', 'mock']).default('gemini'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),
  AI_MAX_RETRIES: z.coerce.number().default(2),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.65),
  AI_MAX_CONTEXT_MESSAGES: z.coerce.number().default(20),
  EMBEDDING_PROVIDER: z.enum(['openai', 'gemini', 'mock']).default('mock'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  RAG_TOP_K: z.coerce.number().default(5),
  RAG_MIN_SCORE: z.coerce.number().default(0.6),

  // Natural Human Response Delay Configuration
  RESPONSE_DELAY_ENABLED: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(true),
  RESPONSE_DELAY_MIN_MS: z.coerce.number().default(2000),
  RESPONSE_DELAY_MAX_MS: z.coerce.number().default(6000),
  RESPONSE_DELAY_PER_CHAR_MS: z.coerce.number().default(25),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    console.error(`[FATAL] Environment validation failed: ${formattedErrors}`);
    throw new Error(`Environment validation failed: ${formattedErrors}`);
  }

  _env = result.data;
  return _env;
}

export function parseCorsOrigins(corsOriginsStr: string): string[] {
  return corsOriginsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
