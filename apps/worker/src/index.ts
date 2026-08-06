import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

console.log('[Worker] LImax Worker started');
console.log(`[Worker] Environment: ${process.env.NODE_ENV ?? 'development'}`);

process.on('SIGTERM', () => {
  console.log('[Worker] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Worker] Interrupted, shutting down...');
  process.exit(0);
});
