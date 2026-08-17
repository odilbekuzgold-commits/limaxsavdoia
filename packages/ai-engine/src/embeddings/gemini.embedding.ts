import type { EmbeddingProvider } from './types.js';

export interface GeminiEmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'gemini';
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private timeoutMs: number;

  constructor(config?: GeminiEmbeddingConfig) {
    this.apiKey = config?.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = config?.model || process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
    this.dimensions = config?.dimensions || 1536;
    this.timeoutMs = config?.timeoutMs || 10000;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error('Gemini Embedding Provider: API key is not configured');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const results: number[][] = [];

      for (const text of texts) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text: text.slice(0, 8000) }] },
            outputDimensionality: this.dimensions,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Gemini Embedding API returned status ${response.status}`);
        }

        const data = (await response.json()) as {
          embedding?: { values?: number[] };
        };

        const vec = data?.embedding?.values;
        if (!Array.isArray(vec) || vec.length !== this.dimensions) {
          throw new Error(`Gemini Embedding response dimension mismatch: expected ${this.dimensions}, got ${vec?.length ?? 0}`);
        }

        for (let i = 0; i < vec.length; i++) {
          if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) {
            throw new Error(`Gemini Embedding response contains non-finite float at index ${i}`);
          }
        }

        results.push(vec);
      }

      return results;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Gemini Embedding request timed out after ${this.timeoutMs}ms`);
      }
      const safeMsg = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Gemini Embedding generation failed: ${safeMsg}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
