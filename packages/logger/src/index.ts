import { pino, type LoggerOptions } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

export const defaultRedactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'DATABASE_URL',
  'REDIS_URL',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.secret',
];

export function createLogger(serviceName: string, level = 'info') {
  const options: LoggerOptions = {
    name: serviceName,
    level,
    redact: {
      paths: defaultRedactPaths,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return pino(options);
}

export function createHttpLogger(serviceName: string, level = 'info'): HttpLogger {
  const logger = createLogger(serviceName, level);
  return pinoHttp({
    logger,
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}

export const logger = createLogger('limax-app');
