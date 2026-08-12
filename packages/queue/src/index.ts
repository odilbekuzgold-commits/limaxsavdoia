import { connectRedis, getRedisClient } from '@limax/redis';

export const DEFAULT_QUEUE = 'limax:jobs';

export type QueueJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export async function enqueueJob(
  job: Omit<QueueJob, 'createdAt'>,
  queue = DEFAULT_QUEUE,
): Promise<void> {
  const client = await connectRedis();
  await client.lPush(queue, JSON.stringify({ ...job, createdAt: new Date().toISOString() }));
}

export async function createBlockingConsumer(queue = DEFAULT_QUEUE) {
  await connectRedis();
  const client = getRedisClient().duplicate();
  await client.connect();

  return {
    async next(timeoutSeconds = 5): Promise<QueueJob | null> {
      const item = await client.brPop(queue, timeoutSeconds);
      if (!item) return null;
      return JSON.parse(item.element) as QueueJob;
    },
    async close(): Promise<void> {
      if (client.isOpen) await client.quit();
    },
  };
}
