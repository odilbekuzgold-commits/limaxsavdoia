import type { AIContext } from '@limax/shared';
import { AIStructuredResultSchema } from '@limax/shared';
import type { IAIProviderAdapter, ProviderRequestOptions, ProviderRawResponse } from './types.js';

export class OpenAIProviderAdapter implements IAIProviderAdapter {
  readonly providerName = 'openai' as const;

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'CHANGE_ME');
  }

  async generateStructuredResponse(
    prompt: string,
    context: AIContext,
    options?: ProviderRequestOptions
  ): Promise<ProviderRawResponse> {
    const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'CHANGE_ME') {
      throw new Error('OpenAI API key is missing or not configured');
    }

    const model = options?.model || process.env.OPENAI_MODEL || 'gpt-4o';
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
}

Never invent or hallucinate price, MOQ, stock, or technical parameters for LImax Yarn if not explicitly present in provided context. If unknown, set needsHandoff: true.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(context.conversationHistory || []).map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: prompt },
    ];

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.2,
          store: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorText.substring(0, 100)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const latencyMs = Date.now() - startTime;
      const rawContent = data.choices?.[0]?.message?.content || '{}';
      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        throw new Error('AI_OUTPUT_INVALID: Failed to parse OpenAI JSON output');
      }

      const validateResult = AIStructuredResultSchema.safeParse(parsedJson);
      if (!validateResult.success) {
        throw new Error(`AI_OUTPUT_INVALID: Zod validation failed: ${validateResult.error.message}`);
      }

      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;

      return {
        result: validateResult.data,
        inputTokens,
        outputTokens,
        latencyMs,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }
}
