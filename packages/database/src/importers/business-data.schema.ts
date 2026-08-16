import { z } from 'zod';

const MOJIBAKE_REGEX = /[ÐÑâ€™â€œÊ¼ÃÂ]/;
const PLACEHOLDER_REGEX = /REPLACE_WITH_REAL|PLACEHOLDER|TEST_DATA|DUMMY_DATA/i;

const safeString = (fieldName: string) =>
  z
    .string({ required_error: `${fieldName} is required` })
    .min(1, `${fieldName} cannot be empty`)
    .refine((val) => !MOJIBAKE_REGEX.test(val), {
      message: `${fieldName} contains invalid UTF-8 / Mojibake encoding`,
    })
    .refine((val) => !PLACEHOLDER_REGEX.test(val), {
      message: `${fieldName} contains unapproved placeholder / test data`,
    });

// 1. Product Import Schema
export const ProductImportSchema = z.object({
  code: safeString('Product code'),
  name: safeString('Product name'),
  active: z.boolean().default(true),
  category: safeString('Category').optional(),
  description: z.string().optional(),
  composition: z.string().optional(),
  yarnCount: z.string().optional(),
  color: z.string().optional(),
  unit: z.string().default('kg'),
  aiRecommendable: z.boolean().default(true),
});

export const ProductImportArraySchema = z.array(ProductImportSchema);
export type ProductImportData = z.infer<typeof ProductImportSchema>;

// 2. Price Import Schema
export const PriceImportSchema = z
  .object({
    productCode: safeString('Product code'),
    amount: z.number().gt(0, 'Price amount must be strictly greater than 0'),
    currency: safeString('Currency'),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
    validFrom: z
      .string()
      .or(z.date())
      .transform((val) => new Date(val)),
    validUntil: z
      .string()
      .or(z.date())
      .optional()
      .transform((val) => (val ? new Date(val) : undefined)),
    minQuantity: z.number().min(0).default(1),
    unit: z.string().default('kg'),
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.validUntil && data.validFrom > data.validUntil) {
        return false;
      }
      return true;
    },
    {
      message: 'validFrom date cannot be after validUntil date',
      path: ['validUntil'],
    }
  );

export const PriceImportArraySchema = z.array(PriceImportSchema);
export type PriceImportData = z.infer<typeof PriceImportSchema>;

// 3. Inventory Import Schema
export const InventoryImportSchema = z
  .object({
    productCode: safeString('Product code'),
    availableQuantity: z.number().min(0, 'availableQuantity cannot be negative'),
    reservedQuantity: z.number().min(0, 'reservedQuantity cannot be negative'),
    unit: z.string().default('kg'),
    status: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).default('IN_STOCK'),
    warehouse: z.string().default('Main Warehouse'),
  })
  .refine(
    (data) => data.reservedQuantity <= data.availableQuantity,
    {
      message: 'reservedQuantity cannot be greater than availableQuantity',
      path: ['reservedQuantity'],
    }
  );

export const InventoryImportArraySchema = z.array(InventoryImportSchema);
export type InventoryImportData = z.infer<typeof InventoryImportSchema>;

// 4. Knowledge Import Schema
export const BusinessKnowledgeImportSchema = z.object({
  source: safeString('Source'),
  title: safeString('Title'),
  content: safeString('Content'),
  language: z
    .enum(['uz', 'uz-Latn', 'uz-Cyrl', 'ru', 'en', 'zh', 'tg', 'kk', 'ky'])
    .default('uz'),
  status: z
    .literal('DRAFT', {
      errorMap: () => ({ message: 'Imported knowledge status MUST strictly be DRAFT' }),
    })
    .default('DRAFT'),
});

export const BusinessKnowledgeImportArraySchema = z.array(BusinessKnowledgeImportSchema);
export type KnowledgeImportData = z.infer<typeof BusinessKnowledgeImportSchema>;
