export interface EmbeddingProvider {
  readonly providerName: string;
  embed(texts: string[]): Promise<number[][]>;
}
