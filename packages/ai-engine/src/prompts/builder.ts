import type { AIContext, Product, SupportedLanguage } from '@limax/shared';
import { SYSTEM_PROMPTS } from './index.js';

export interface BuildPromptOptions {
  language?: SupportedLanguage;
  knowledgeItems?: Array<{ id: string; title: string; content: string; status: string }>;
}

export function buildSalesSystemPrompt(
  context?: AIContext,
  options?: BuildPromptOptions
): string {
  const parts: string[] = [];

  // 1. Core V2 System Prompt
  parts.push(SYSTEM_PROMPTS.salesAssistant);

  // 2. Language & Script Formatting Instruction
  const lang = options?.language || context?.preferredLanguage || 'uz';
  parts.push('\n## TARGET LANGUAGE & SCRIPT INSTRUCTION');
  if (lang === 'uz-Cyrl') {
    parts.push(
      "Mijoz alifbosi: O'zbek kirill. Barcha javoblarni faqat O'zbek kirill alifbosida (U, Q, G, H harflarining kirill shakllari) yozing."
    );
  } else if (lang === 'ru') {
    parts.push('Mijoz tili: Rus tili. Otvechayte strogо na russkom yazyke.');
  } else if (lang === 'en') {
    parts.push('Customer language: English. Respond strictly in English.');
  } else if (lang === 'zh') {
    parts.push('Customer language: Chinese. Respond strictly in Chinese.');
  } else if (lang === 'tg') {
    parts.push('Customer language: Tajik. Respond strictly in Tajik language.');
  } else if (lang === 'kk') {
    parts.push('Customer language: Kazakh. Respond strictly in Kazakh language.');
  } else if (lang === 'ky') {
    parts.push('Customer language: Kyrgyz. Respond strictly in Kyrgyz language.');
  } else {
    // uz / uz-Latn
    parts.push(
      "Mijoz alifbosi: O'zbek lotin. Barcha javoblarni faqat O'zbek lotin alifbosida yozing."
    );
  }
  parts.push(
    "Mahsulot kodi va belgilarini (masalan: 30/70, 75D/36, 2070K) o'zgartirmasdan aynan saqlang."
  );

  // 3. Structured Product / Pricing / Inventory Context (Priority 1 — no fabricated defaults)
  if (context?.availableProducts && context.availableProducts.length > 0) {
    parts.push('\n## STRUCTURED PRODUCT DATA (SUPERCEDES GENERAL KNOWLEDGE BASE)');
    context.availableProducts.forEach((p: Product) => {
      parts.push(`- Product ID: ${p.id}`);
      parts.push(`  Name: ${p.name}`);
      parts.push(`  Category: ${p.category ?? 'UNKNOWN'}`);
      parts.push(`  Description: ${p.description ?? 'UNKNOWN'}`);
      // Price: only emit if explicitly set and non-zero
      if (p.price !== undefined && p.price !== null && p.price > 0) {
        parts.push(`  Active Price: ${p.price} ${p.currency ?? 'UNKNOWN'}`);
      } else {
        parts.push(`  Active Price: UNKNOWN (contact manager)`);
      }
      // MOQ: only emit if explicitly set and > 0
      if (p.minimumOrder !== undefined && p.minimumOrder !== null && p.minimumOrder > 0) {
        parts.push(`  Minimum Order (MOQ): ${p.minimumOrder}`);
      } else {
        parts.push(`  Minimum Order (MOQ): UNKNOWN`);
      }
      // Stock: only emit known statuses, never default to "in_stock"
      const knownStockStatuses = ['in_stock', 'out_of_stock', 'low_stock'];
      if (p.stockStatus && knownStockStatuses.includes(p.stockStatus)) {
        parts.push(`  Stock Status: ${p.stockStatus}`);
      } else {
        parts.push(`  Stock Status: UNKNOWN`);
      }
    });
  }

  // 4. Approved Knowledge Base Context (Priority 2)
  // Uses typed approvedKnowledgeItems from AIContext (APPROVED-filtered by orchestrator)
  // OR falls back to knowledgeItems option filtered to APPROVED status
  const approvedItems =
    context?.approvedKnowledgeItems ??
    (options?.knowledgeItems ?? []).filter((k) => k.status === 'APPROVED');

  if (approvedItems.length > 0) {
    parts.push('\n## APPROVED KNOWLEDGE BASE CONTEXT (ONLY APPROVED ITEMS USABLE)');
    approvedItems.forEach((item) => {
      parts.push(`[ID: ${item.id}] ${item.title}: ${item.content}`);
    });
  }

  // 5. Output JSON Schema Instruction
  parts.push(`\n## MANDATORY JSON OUTPUT FORMAT
Respond ONLY with a single valid JSON object matching this schema (no markdown wrap or extra text):
{
  "replyText": "Response string in target language",
  "language": "uz" | "uz-Latn" | "uz-Cyrl" | "ru" | "en" | "zh" | "tg" | "kk" | "ky",
  "intent": "general_inquiry" | "product_price" | "product_stock" | "sample_request" | "order" | "complaint" | "security_blocked",
  "confidence": 0.0 to 1.0,
  "needsHandoff": boolean,
  "handoffReason": "Optional string — only when needsHandoff is true",
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
STRICT RULES:
- Never invent a price, MOQ, or stock level not present in STRUCTURED PRODUCT DATA.
- If price is UNKNOWN, say so and direct to manager.
- If MOQ is UNKNOWN, say so and direct to manager.
- If stock is UNKNOWN, say UNKNOWN — never claim it is available.`);

  return parts.join('\n');
}
