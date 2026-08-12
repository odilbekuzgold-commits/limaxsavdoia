import type { AIContext, AIStructuredResult } from '@limax/shared';

export interface ProviderRequestOptions {
  timeoutMs?: number;
  model?: string;
  apiKey?: string;
}

export interface ProviderRawResponse {
  result: AIStructuredResult;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  rawResponse?: unknown;
}

export interface IAIProviderAdapter {
  readonly providerName: 'openai' | 'gemini' | 'claude' | 'mock';
  isConfigured(): boolean;
  generateStructuredResponse(
    prompt: string,
    context: AIContext,
    options?: ProviderRequestOptions
  ): Promise<ProviderRawResponse>;
}
