import type { EmbeddingProvider } from './types.js';
import { MockEmbeddingProvider } from './mock.embedding.js';
import { OpenAIEmbeddingProvider } from './openai.embedding.js';
import { GeminiEmbeddingProvider } from './gemini.embedding.js';

export interface EmbeddingProviderFactoryConfig {
  providerName?: 'openai' | 'gemini' | 'mock';
  apiKey?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
  environment?: string;
}

export function createEmbeddingProvider(config?: EmbeddingProviderFactoryConfig): EmbeddingProvider {
  const providerName = (config?.providerName || process.env.EMBEDDING_PROVIDER || 'openai').toLowerCase();
  const env = config?.environment || process.env.NODE_ENV || 'development';
  const apiKey = config?.apiKey || (providerName === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);

  if (providerName === 'mock') {
    if (env === 'production') {
      throw new Error('MockEmbeddingProvider is strictly rejected in production environments');
    }
    return new MockEmbeddingProvider();
  }

  // Non-production test/development fallback when no live AI API key is present
  if (!apiKey && env !== 'production') {
    return new MockEmbeddingProvider();
  }

  if (providerName === 'gemini') {
    return new GeminiEmbeddingProvider({
      apiKey,
      model: config?.model,
      dimensions: config?.dimensions || 1536,
      timeoutMs: config?.timeoutMs,
    });
  }

  // Default to OpenAI
  return new OpenAIEmbeddingProvider({
    apiKey,
    model: config?.model,
    dimensions: config?.dimensions || 1536,
    timeoutMs: config?.timeoutMs,
  });
}
