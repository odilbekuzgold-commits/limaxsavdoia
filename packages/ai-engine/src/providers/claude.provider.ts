import type { AIContext } from '@limax/shared';
import { AIStructuredResultSchema } from '@limax/shared';
import type { IAIProviderAdapter, ProviderRequestOptions, ProviderRawResponse } from './types.js';

export class ClaudeProviderAdapter implements IAIProviderAdapter {
  readonly providerName = 'claude' as const;

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'CHANGE_ME');
  }

  async generateStructuredResponse(
    prompt: string,
    context: AIContext,
    options?: ProviderRequestOptions
  ): Promise<ProviderRawResponse> {
    const apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'CHANGE_ME') {
      throw new Error('Anthropic API key is missing or disabled');
    }

    const model = options?.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    const timeoutMs = options?.timeoutMs || 30000;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const systemPrompt = `You are LImax Yarn B2B AI Assistant.
Respond ONLY with a valid JSON object matching this schema:
{
  "replyText": "Response in customer language",
  "language": "uz" | "ru" | "en" | "zh" | "tg" | "kk" | "ky",
  "intent": "general_inquiry" | "product_price" | "moq" | "order" | "complaint",
  "confidence": 0.0 to 1.0,
  "needsHandoff": boolean,
  "handoffReason": "Optional reason string",
  "leadSignals": {
    "productNeed": "Optional string",
    "quantity": "Optional string",
    "purchaseTime": "Optional string",
    "region": "Optional string",
    "budget": "Optional string",
    "authority": "Optional string"
  },
  "usedKnowledgeIds": []
}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Claude API error (${response.status}): ${errorText.substring(0, 100)}`);
      }

      const data = (await response.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const latencyMs = Date.now() - startTime;
      const rawContent = data.content?.[0]?.text || '{}';
      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        throw new Error('AI_OUTPUT_INVALID: Failed to parse Claude JSON output');
      }

      const validateResult = AIStructuredResultSchema.safeParse(parsedJson);
      if (!validateResult.success) {
        throw new Error(`AI_OUTPUT_INVALID: Zod validation failed: ${validateResult.error.message}`);
      }

      const inputTokens = data.usage?.input_tokens || 0;
      const outputTokens = data.usage?.output_tokens || 0;

      return {
        result: validateResult.data,
        inputTokens,
        outputTokens,
        latencyMs,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Claude request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }
}
