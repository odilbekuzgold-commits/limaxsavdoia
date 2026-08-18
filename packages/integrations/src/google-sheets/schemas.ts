import { z } from 'zod';

export const REQUIRED_SPREADSHEET_ID = '1a8ouEPIArKhHzrLlmGGlpiD1wKYqOFKHzMoY9JkllBI';

export const VALID_SHEET_TABS = ['Products', 'Prices', 'Inventory', 'Sync_Control'] as const;

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
export const parseNumeric = (val: unknown): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const sanitized = val.trim().replace(',', '.');
    const num = parseFloat(sanitized);
    if (!isNaN(num)) return num;
  }
  return NaN;
};

// 1. Products Tab Schema
export const SheetProductRowSchema = z.object({
  rowNumber: z.number().int(),
  productCode: z.string().min(1, 'productCode is required'),
  productName: z.string().min(1, 'productName is required'),
  category: z.string().default('General'),
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
  minOrderQuantity: z.preprocess(parseNumeric, z.number().gte(0).default(1)),
  approvalStatus: z.string().transform((s) => s.trim().toUpperCase()),
  syncEnabled: z.preprocess(parseBoolean, z.boolean()),
  notes: z.string().optional(),
});
export type SheetPriceRow = z.infer<typeof SheetPriceRowSchema>;

// 3. Inventory Tab Schema
export const SheetInventoryRowSchema = z.object({
  rowNumber: z.number().int(),
  productCode: z.string().min(1, 'productCode is required'),
  availableQuantity: z.preprocess(parseNumeric, z.number().gte(0, 'availableQuantity must be >= 0')),
  reservedQuantity: z.preprocess(parseNumeric, z.number().gte(0, 'reservedQuantity must be >= 0').default(0)),
  unit: z.string().default('kg'),
  warehouse: z.string().default('Toshkent Bosh Ombor'),
  approvalStatus: z.string().transform((s) => s.trim().toUpperCase()),
  syncEnabled: z.preprocess(parseBoolean, z.boolean()),
  notes: z.string().optional(),
}).refine((data) => data.reservedQuantity <= data.availableQuantity, {
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
