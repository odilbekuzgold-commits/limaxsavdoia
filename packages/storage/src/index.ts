import * as Minio from 'minio';

export type StorageHealthStatus = {
  status: 'ok' | 'unavailable';
  latencyMs?: number;
  error?: string;
};

let _minioClient: Minio.Client | null = null;

export function getStorageClient(): Minio.Client {
  if (_minioClient) return _minioClient;

  const endPoint = process.env.MINIO_ENDPOINT || 'localhost';
  const port = Number(process.env.MINIO_PORT || 9000);
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  const accessKey = process.env.MINIO_ACCESS_KEY || 'limax_minio_admin';
  const secretKey = process.env.MINIO_SECRET_KEY || 'LimaxManager1122';

  _minioClient = new Minio.Client({
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey,
  });

  return _minioClient;
}

export async function ensureBucket(bucketName?: string): Promise<void> {
  const client = getStorageClient();
  const bucket = bucketName || process.env.MINIO_BUCKET_NAME || 'limax-media';
  const exists = await client.bucketExists(bucket);

  if (!exists) {
    if (process.env.NODE_ENV === 'development') {
      await client.makeBucket(bucket, 'us-east-1');
      console.log(`[Storage] Development bucket created: ${bucket}`);
    } else {
      throw new Error(`Storage bucket '${bucket}' does not exist.`);
    }
  }
}

export async function checkStorageHealth(
  timeoutMs = 3000,
): Promise<StorageHealthStatus> {
  const start = Date.now();
  try {
    const client = getStorageClient();
    const bucket = process.env.MINIO_BUCKET_NAME || 'limax-media';

    const checkPromise = client.bucketExists(bucket);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MinIO bucket check timeout')), timeoutMs),
    );

    await Promise.race([checkPromise, timeoutPromise]);

    return {
      status: 'ok',
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'MinIO storage check failed',
    };
  }
}
