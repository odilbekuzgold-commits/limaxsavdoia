import type { ExtractedEntities } from './types.js';
import { PROTECTED_PRODUCT_TOKEN_RE } from './normalizer.js';


export function extractEntities(text: string): ExtractedEntities {
  if (!text) return {};

  const entities: ExtractedEntities = {};

  // 1. Product token extraction
  const productMatches = text.match(PROTECTED_PRODUCT_TOKEN_RE);
  if (productMatches && productMatches.length > 0) {
    entities.product = productMatches[0].toUpperCase();
  } else {
    // Check secondary product keywords
    const secondaryMatch = text.match(/\b(polyester|poliyester|spandex|neylon|naylon|rezinka|bobina|pux)\b/i);
    if (secondaryMatch) {
      entities.product = secondaryMatch[0].toLowerCase();
    }
  }

  // 2. Quantity extraction (e.g., 500 kg, 3 tonna, 2 karobka, 96 bobina)
  const qtyMatch = text.match(/(\d+(?:[\.,]\d+)?)\s*(tonna|tn|кг|kg|karobka|коробка|коробки|bobina|бабина|штук|dona)/i);
  if (qtyMatch) {
    entities.quantity = `${qtyMatch[1]} ${qtyMatch[2].toLowerCase()}`;
  }

  // 3. Color extraction
  const colorMatch = text.match(/\b(oq|qora|seriy|серий|оч серий|туқ серий|пепси|qizil|кизил|bejvy|sariq|hakki|optik|черный|оқ|қора)\b/i);
  if (colorMatch) {
    entities.color = colorMatch[0].toLowerCase();
  }

  // 4. Location extraction
  const locationMatch = text.match(/\b(toshkent|тошкент|qo'qon|qoqon|қуқон|andijon|андижон|angren|ангрен|namangan|наманган|samarqand|самарканд|buxoro|бухоро|rossiya|россия|germaniya|франкфурт)\b/i);
  if (locationMatch) {
    entities.location = locationMatch[0];
  }

  // 5. Order reference extraction (e.g., #1234 or zakaz 1234 or spec 1234)
  const orderRefMatch = text.match(/\b(?:zakaz|order|spec|спец|nomer|№|#)\s*([a-z0-9\-]{2,15})\b/i);
  if (orderRefMatch) {
    entities.order_reference = orderRefMatch[1];
  }

  return entities;
}
