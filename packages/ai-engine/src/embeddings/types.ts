export interface EmbeddingProvider {
  readonly providerName: string;
  readonly modelName: string;
  embed(texts: string[]): Promise<number[][]>;
}
