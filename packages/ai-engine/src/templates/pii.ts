// PII Sanitizer & Redaction Module

const PHONE_REGEX =
  /(\+?998[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})|(\b9\d{8}\b)|(\b\d{2}[\s\-]\d{3}[\s\-]\d{2}[\s\-]\d{2}\b)/gi;

const FINANCIAL_REGEX =
  /(\b8600[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b)|(\b9860[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b)|(\b20208\d{15}\b)/gi;

export function sanitizePiiText(text: string): { sanitized: string; hasPii: boolean } {
  if (!text) return { sanitized: '', hasPii: false };

  let hasPii = false;
  let sanitized = text;

  if (PHONE_REGEX.test(sanitized)) {
    hasPii = true;
    sanitized = sanitized.replace(PHONE_REGEX, '[REDACTED_PHONE]');
  }

  if (FINANCIAL_REGEX.test(sanitized)) {
    hasPii = true;
    sanitized = sanitized.replace(FINANCIAL_REGEX, '[REDACTED_FINANCIAL]');
  }

  return { sanitized, hasPii };
}

export function sanitizePiiObject<T>(obj: T): T {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    return sanitizePiiText(obj).sanitized as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizePiiObject(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    const res: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === 'string') {
        res[key] = sanitizePiiText(val).sanitized;
      } else if (typeof val === 'object' && val !== null) {
        res[key] = sanitizePiiObject(val);
      } else {
        res[key] = val;
      }
    }
    return res as unknown as T;
  }
  return obj;
}
