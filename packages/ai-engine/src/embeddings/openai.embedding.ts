import type { EmbeddingProvider } from './types.js';

export interface OpenAIEmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'openai';
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private timeoutMs: number;

  constructor(config?: OpenAIEmbeddingConfig) {
    this.apiKey = config?.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config?.model || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    this.dimensions = config?.dimensions || parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536', 10);
    this.timeoutMs = config?.timeoutMs || 10000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error('OpenAI Embedding Provider: API key is not configured');
    }

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
        throw new Error(`OpenAI Embedding request timed out after ${this.timeoutMs}ms`);
      }
      const safeMsg = err instanceof Error ? err.message : 'Unknown embedding error';
      throw new Error(`OpenAI Embedding generation failed: ${safeMsg}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
