import type { DictionaryItem } from './types.js';

// Exact product token regex — MUST be preserved without alteration
export const PROTECTED_PRODUCT_TOKEN_RE =
  /\b(40100K|40\/100K|20100K|20\/100K|30100K|30\/100K|20150K|20\/150K|40150K|40\/150K|1575K|2075K|3075K|4075K|2070K|3070K|30\/70|20\/70|15\/55|15\/75|20\/75|30\/75|75D\/36|75D36|75D\/2|70D\/2|40D\/2|40D\/1|70D\/1|40\/1|40\/2|70\/1|70\/24|32S|DTY|FDY|POY|SDY|SPUN|W300D\/96|W300D96|300D\/96|300D96|W300D|300D|300LIK|300|W150D|150D|W100D|100D)\b/gi;

export function normalizeCustomerMessage(
  text: string,
  dictionary: DictionaryItem[]
): { normalizedText: string; preservedTokens: string[] } {
  if (!text) return { normalizedText: '', preservedTokens: [] };

  const productRe = new RegExp(PROTECTED_PRODUCT_TOKEN_RE.source, 'gi');

  // 1. Extract protected product tokens first
  const preservedTokens: string[] = [];
  const tokenMap = new Map<string, string>();

  let tokenIndex = 0;
  const textWithPlaceholders = text.replace(productRe, (match) => {
    const placeholder = `__PRODUCT_TOKEN_${tokenIndex}__`;
    preservedTokens.push(match.toUpperCase());
    tokenMap.set(placeholder, match.toUpperCase());
    tokenIndex++;
    return placeholder;
  });

  // 2. Clean spaces and newlines
  let normalized = textWithPlaceholders
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3. Apply dictionary replacement word by word / phrase by phrase
  for (const item of dictionary) {
    if (!item.variant || !item.normalized_form) continue;
    const escapedVariant = item.variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedVariant}\\b`, 'gi');
    normalized = normalized.replace(regex, item.normalized_form);
  }

  // 4. Restore protected product tokens
  for (const [placeholder, token] of tokenMap.entries()) {
    normalized = normalized.replace(placeholder, token);
  }

  return {
    normalizedText: normalized,
    preservedTokens,
  };
}
