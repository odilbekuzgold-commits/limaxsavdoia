import type { AIContext } from '@limax/shared';
import { AIStructuredResultSchema } from '@limax/shared';
import type { IAIProviderAdapter, ProviderRequestOptions, ProviderRawResponse } from './types.js';
import { buildSalesSystemPrompt } from '../prompts/index.js';
import { detectLanguage } from '../index.js';

export class GeminiProviderAdapter implements IAIProviderAdapter {
  readonly providerName = 'gemini' as const;

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'CHANGE_ME');
  }

  async generateStructuredResponse(
    prompt: string,
    context: AIContext,
    options?: ProviderRequestOptions
  ): Promise<ProviderRawResponse> {
    const apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'CHANGE_ME') {
      throw new Error('Gemini API key is missing or not configured');
    }

    const model = options?.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const timeoutMs = options?.timeoutMs || 30000;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const lang = context.preferredLanguage || detectLanguage(prompt);
    const systemPrompt = buildSalesSystemPrompt(context, { language: lang });

    const contents = [
      ...(context.conversationHistory || []).map((m: { role: string; content: string }) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText.substring(0, 100)}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const latencyMs = Date.now() - startTime;
      const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      let parsedJson: unknown;

      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        throw new Error('AI_OUTPUT_INVALID: Failed to parse Gemini JSON output');
      }

      const validateResult = AIStructuredResultSchema.safeParse(parsedJson);
      if (!validateResult.success) {
        throw new Error(`AI_OUTPUT_INVALID: Zod validation failed: ${validateResult.error.message}`);
      }

      const inputTokens = data.usageMetadata?.promptTokenCount || 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

      return {
        result: validateResult.data,
        inputTokens,
        outputTokens,
        latencyMs,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Gemini request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }
  }
}
