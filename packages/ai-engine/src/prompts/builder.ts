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
    parts.push('Mijoz alifbosi: O‘zbek kirill. Barcha javoblarni faqat O‘zbek kirill alifbosida (Ў, Қ, Ғ, Ҳ) yozing.');
  } else if (lang === 'ru') {
    parts.push('Mijoz tili: Rus tili. Отвечайте строго на русском языке.');
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
    parts.push('Mijoz alifbosi: O‘zbek lotin. Barcha javoblarni faqat O‘zbek lotin alifbosida yozing.');
  }
  parts.push('Mahsulot kodi va belgilarini (masalan: 30/70, 75D/36, 2070K) o‘zgartirmasdan aynan saqlang.');

  // 3. Structured Product / Pricing / Inventory Context (Priority 1)
  if (context?.availableProducts && context.availableProducts.length > 0) {
    parts.push('\n## STRUCTURED PRODUCT DATA (SUPERCEDES GENERAL KNOWLEDGE BASE)');
    context.availableProducts.forEach((p: Product) => {
      parts.push(`- Product ID: ${p.id}`);
      parts.push(`  Name: ${p.name}`);
      parts.push(`  Category: ${p.category}`);
      parts.push(`  Description: ${p.description}`);
      parts.push(`  Active Price: ${p.price} ${p.currency || 'USD'}`);
      parts.push(`  Minimum Order (MOQ): ${p.minimumOrder || 1}`);
      parts.push(`  Stock Status: ${p.stockStatus || 'in_stock'}`);
    });
  }

  // 4. Approved Knowledge Base Context (Priority 2) - Filter out DRAFT, REJECTED, ARCHIVED
  if (options?.knowledgeItems && options.knowledgeItems.length > 0) {
    const approvedOnly = options.knowledgeItems.filter((k) => k.status === 'APPROVED');
    if (approvedOnly.length > 0) {
      parts.push('\n## APPROVED KNOWLEDGE BASE CONTEXT (ONLY APPROVED ITEMS USABLE)');
      approvedOnly.forEach((item) => {
        parts.push(`[ID: ${item.id}] ${item.title}: ${item.content}`);
      });
    }
  } else if (context?.knowledgeSnippets && context.knowledgeSnippets.length > 0) {
    parts.push('\n## APPROVED KNOWLEDGE BASE CONTEXT');
    context.knowledgeSnippets.forEach((snippet: string) => {
      parts.push(`- ${snippet}`);
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
  "handoffReason": "Optional string",
  "leadSignals": {
    "productNeed": "Optional string",
    "quantity": "Optional string",
    "purchaseTime": "Optional string",
    "region": "Optional string",
    "budget": "Optional string",
    "authority": "Optional string"
  },
  "usedKnowledgeIds": []
}`);

  return parts.join('\n');
}
