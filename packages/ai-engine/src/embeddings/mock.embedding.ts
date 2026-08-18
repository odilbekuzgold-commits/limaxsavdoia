import type { EmbeddingProvider } from './types.js';

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly providerName = 'mock';
  readonly modelName = 'mock-1536';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array(1536).fill(0);
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
      }
      vec[0] = (Math.abs(hash) % 100) / 100;
      vec[1] = Math.min(1, text.length / 1000);
      return vec;
    });
  }
}
