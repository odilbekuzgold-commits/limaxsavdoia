import { createClient, type RedisClientType } from 'redis';

export type RedisHealthStatus = {
  status: 'ok' | 'unavailable';
  latencyMs?: number;
  error?: string;
};

let _client: RedisClientType | null = null;

export function getRedisClient(url?: string): RedisClientType {
  if (_client) return _client;

  const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';

  _client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          console.warn('[Redis] Max reconnection retries reached.');
          return new Error('Max retries reached');
        }
        return Math.min(retries * 500, 3000);
      },
    },
  }) as RedisClientType;

  _client.on('error', (err) => {
    console.error('[Redis Client Error]', err.message);
  });

  return _client;
}

export async function connectRedis(): Promise<RedisClientType> {
  const client = getRedisClient();
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (_client && _client.isOpen) {
    await _client.quit();
    _client = null;
  }
}

export async function checkRedisHealth(
  timeoutMs = 3000,
): Promise<RedisHealthStatus> {
  const start = Date.now();
  try {
    const client = getRedisClient();
    if (!client.isOpen) {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), timeoutMs),
        ),
      ]);
    }

    const pong = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PING timeout')), timeoutMs),
      ),
    ]);

    if (pong === 'PONG') {
      return {
        status: 'ok',
        latencyMs: Date.now() - start,
      };
    }

    return {
      status: 'unavailable',
      error: 'Unexpected PING response',
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'Redis connection failed',
    };
  }
}
