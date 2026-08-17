import type { EmbeddingProvider } from './types.js';

export interface OpenAIEmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
  batchSize?: number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'openai';
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private timeoutMs: number;
  private batchSize: number;

  constructor(config?: OpenAIEmbeddingConfig) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config?.model || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    this.dimensions = config?.dimensions || parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536', 10);
    this.timeoutMs = config?.timeoutMs || 10000;
    this.batchSize = config?.batchSize || 20;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const sanitizedTexts = texts.map((t) => (t || '').slice(0, 8000));

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: sanitizedTexts,
          dimensions: this.dimensions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          throw new Error('OPENAI_AUTH_FAILED: OpenAI API key is invalid or unauthorized');
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
        throw new Error(`OPENAI_TIMEOUT: OpenAI embedding request timed out after ${this.timeoutMs}ms`);
      }
      const safeMsg = err instanceof Error ? err.message : 'Unknown embedding error';
      // Sanitize any accidental key leak
      const maskedMsg = safeMsg.replace(/sk-[a-zA-Z0-9_-]+/g, '[MASKED_KEY]');
      throw new Error(`OpenAI Embedding generation failed: ${maskedMsg}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error('OPENAI_AUTH_FAILED: OpenAI API key is not configured');
    }

    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchEmbeddings = await this.embedBatch(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    return allEmbeddings;
  }
}
