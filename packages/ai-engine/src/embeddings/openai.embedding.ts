import type { EmbeddingProvider } from './types.js';

export interface OpenAIEmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
  batchSize?: number;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'openai';
  readonly modelName: string;
  private apiKey: string;
  private dimensions: number;
  private timeoutMs: number;
  private batchSize: number;
  private maxRetries: number;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(config?: OpenAIEmbeddingConfig) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
    this.modelName = config?.model || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    this.dimensions = config?.dimensions || parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536', 10);
    this.timeoutMs = config?.timeoutMs || 10000;
    this.batchSize = config?.batchSize || 20;
    this.maxRetries = config?.maxRetries ?? 3;
    this.sleepFn = config?.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async embedBatchWithRetry(texts: string[]): Promise<number[][]> {
    const sanitizedTexts = texts.map((t) => (t || '').slice(0, 8000));
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.modelName,
            input: sanitizedTexts,
            dimensions: this.dimensions,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const status = response.status;
          // Non-retryable authentication / authorization failures
          if (status === 401 || status === 403) {
            throw new Error('OPENAI_AUTH_FAILED: OpenAI API key is invalid or unauthorized');
          }

          const isTransient = status === 429 || status >= 500;
          if (isTransient && attempt < this.maxRetries) {
            // Check Retry-After header
            let delayMs = Math.min(2000 * Math.pow(2, attempt - 1) + Math.random() * 200, 10000);
            const retryAfterHeader = response.headers.get('retry-after');
            if (retryAfterHeader) {
              const seconds = parseFloat(retryAfterHeader);
              if (!isNaN(seconds) && seconds > 0) {
                delayMs = Math.min(seconds * 1000, 15000);
              }
            }

            await this.sleepFn(delayMs);
            continue;
          }

          if (status === 429) {
            throw new Error('OPENAI_QUOTA_EXCEEDED: OpenAI rate limit or quota exceeded');
          }
          if (status >= 500) {
            throw new Error(`OPENAI_SERVICE_UNAVAILABLE: OpenAI server error ${status}`);
          }
          throw new Error(`OpenAI Embedding API failed with status ${status}`);
        }

        const data = (await response.json()) as {
          data?: Array<{ embedding?: number[]; index?: number }>;
        };

        if (!data || !Array.isArray(data.data)) {
          throw new Error('OpenAI Embedding API returned invalid response payload');
        }

        const results: number[][] = [];
        for (const item of data.data) {
          const vec = item.embedding;
          if (!Array.isArray(vec) || vec.length !== this.dimensions) {
            throw new Error(`OpenAI Embedding response dimension mismatch: expected ${this.dimensions}, got ${vec?.length ?? 0}`);
          }

          for (let i = 0; i < vec.length; i++) {
            if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) {
              throw new Error(`OpenAI Embedding response contains non-finite float at index ${i}`);
            }
          }
          results.push(vec);
        }

        return results;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (attempt < this.maxRetries) {
            await this.sleepFn(Math.min(1000 * Math.pow(2, attempt - 1), 5000));
            continue;
          }
          throw new Error(`OPENAI_TIMEOUT: OpenAI embedding request timed out after ${this.timeoutMs}ms`);
        }

        const safeMsg = err instanceof Error ? err.message : 'Unknown embedding error';
        const maskedMsg = safeMsg.replace(/sk-[a-zA-Z0-9_-]+/g, '[MASKED_KEY]');

        // If it's a non-retryable auth or dimension error, do not retry
        if (maskedMsg.includes('OPENAI_AUTH_FAILED') || maskedMsg.includes('dimension mismatch')) {
          throw new Error(`OpenAI Embedding generation failed: ${maskedMsg}`);
        }

        lastError = new Error(`OpenAI Embedding generation failed: ${maskedMsg}`);
        if (attempt < this.maxRetries) {
          await this.sleepFn(Math.min(1000 * Math.pow(2, attempt - 1), 5000));
          continue;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error('OpenAI Embedding generation failed after maximum retries');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error('OPENAI_AUTH_FAILED: OpenAI API key is not configured');
    }

    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchEmbeddings = await this.embedBatchWithRetry(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    return allEmbeddings;
  }
}
