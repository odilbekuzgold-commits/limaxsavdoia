import { z } from 'zod';

export const REQUIRED_SPREADSHEET_ID = '1a8ouEPIArKhHzrLlmGGlpiD1wKYqOFKHzMoY9JkllBI';

export function getSpreadsheetId(): string {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || REQUIRED_SPREADSHEET_ID;
}

export const VALID_SHEET_TABS = [
  'Products',
  'Prices',
  'Inventory',
  'Sync_Control',
  'QA_HUMAN_MANAGER',
  'BUSINESS_RULES_CODEX',
  'CODEX_RUNTIME_MAP',
] as const;

// Helper: parse string booleans
export const parseBoolean = (val: unknown): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y';
  }
  return false;
};

// Helper: parse comma decimals or numbers
export const parseNumeric = (val: unknown): number | undefined => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return undefined;
    const sanitized = trimmed.replace(',', '.');
    const num = parseFloat(sanitized);
    if (!isNaN(num)) return num;
  }
  return NaN;
};

// Helper: parse nullable numeric (for unknown inventory)
export const parseNullableNumeric = (val: unknown): number | null => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'UNKNOWN' || trimmed === '-') return null;
    const sanitized = trimmed.replace(',', '.');
    const num = parseFloat(sanitized);
    return isNaN(num) ? null : num;
  }
  return null;
};

// 1. Products Tab Schema (Source-Fidelity: preserve raw names, tokens, empty color)
export const SheetProductRowSchema = z.object({
  rowNumber: z.number().int(),
  productCode: z.string().min(1, 'productCode is required'),
  productName: z.string().min(1, 'productName is required'),
  category: z.string().default('General'),
  color: z.string().optional().default(''),
  yarnType: z.string().optional().default(''),
  count: z.string().optional().default(''),
  composition: z.string().optional().default(''),
  description: z.string().optional().default(''),
  unit: z.string().default('kg'),
  active: z.preprocess(parseBoolean, z.boolean().default(true)),
  approvalStatus: z.string().transform((s) => s.trim().toUpperCase()),
  syncEnabled: z.preprocess(parseBoolean, z.boolean()),
  notes: z.string().optional(),
});
export type SheetProductRow = z.infer<typeof SheetProductRowSchema>;

// 2. Prices Tab Schema
export const SheetPriceRowSchema = z.object({
  rowNumber: z.number().int(),
  productCode: z.string().min(1, 'productCode is required'),
  paymentType: z.string().transform((s) => s.trim().toUpperCase()).pipe(
    z.enum(['BANK_TRANSFER', 'CASH', 'LEGACY'])
  ),
  amount: z.preprocess(parseNumeric, z.number().gt(0, 'Price amount must be > 0')),
  currency: z.string().min(1).default('USD'),
  unit: z.string().min(1).default('kg'),
  minOrderQuantity: z.preprocess(parseNullableNumeric, z.number().gte(0).nullable().optional()),
  approvalStatus: z.string().transform((s) => s.trim().toUpperCase()),
  syncEnabled: z.preprocess(parseBoolean, z.boolean()),
  notes: z.string().optional(),
});
export type SheetPriceRow = z.infer<typeof SheetPriceRowSchema>;

// 3. Inventory Tab Schema (Nullable quantities for UNKNOWN stock without falsifying to 0)
export const SheetInventoryRowSchema = z.object({
  rowNumber: z.number().int(),
  productCode: z.string().min(1, 'productCode is required'),
  availableQuantity: z.preprocess(parseNullableNumeric, z.number().gte(0, 'availableQuantity must be >= 0').nullable()),
  reservedQuantity: z.preprocess((v) => (v === '' || v === undefined ? 0 : parseNullableNumeric(v)), z.number().gte(0, 'reservedQuantity must be >= 0').nullable().default(0)),
  unit: z.string().default('kg'),
  warehouse: z.string().default('Toshkent Bosh Ombor'),
  approvalStatus: z.string().transform((s) => s.trim().toUpperCase()),
  syncEnabled: z.preprocess(parseBoolean, z.boolean()),
  notes: z.string().optional(),
}).refine((data) => {
  if (data.availableQuantity !== null && data.reservedQuantity !== null) {
    return data.reservedQuantity <= data.availableQuantity;
  }
  return true;
}, {
  message: 'reservedQuantity cannot exceed availableQuantity',
  path: ['reservedQuantity'],
});
export type SheetInventoryRow = z.infer<typeof SheetInventoryRowSchema>;

// 4. Sync Control Tab Schema
export const SheetSyncControlRowSchema = z.object({
  rowNumber: z.number().int(),
  key: z.string(),
  value: z.string(),
  notes: z.string().optional(),
});
export type SheetSyncControlRow = z.infer<typeof SheetSyncControlRowSchema>;
