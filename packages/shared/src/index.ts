import { z } from 'zod';

// ==========================================
// Enums & Types
// ==========================================

export const ConversationStatusEnum = z.enum([
  'AI_ACTIVE',
  'WAITING_CUSTOMER',
  'WAITING_MANAGER',
  'MANAGER_ACTIVE',
  'PAUSED',
  'CLOSED',
  'BLOCKED',
]);
export type ConversationStatus = z.infer<typeof ConversationStatusEnum>;

export const MessageStatusEnum = z.enum([
  'RECEIVED',
  'QUEUED',
  'PROCESSING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'CANCELLED',
  'NOT_SENT',
]);
export type MessageStatus = z.infer<typeof MessageStatusEnum>;

export const LeadTemperatureEnum = z.enum(['COLD', 'WARM', 'HOT']);
export type LeadTemperature = z.infer<typeof LeadTemperatureEnum>;

export const KnowledgeStatusEnum = z.enum([
  'DRAFT',
  'APPROVED',
  'REJECTED',
  'ARCHIVED',
]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusEnum>;

export const SupportedLanguageEnum = z.enum([
  'uz',
  'uz-Latn',
  'uz-Cyrl',
  'ru',
  'en',
  'zh',
  'tg',
  'kk',
  'ky',
]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageEnum>;

// Stage 6 RBAC Roles & Permissions
export const UserRoleEnum = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'SALES_MANAGER',
  'CONTENT_MANAGER',
  'VIEWER',
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

export type Permission =
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'pricing.read'
  | 'pricing.create'
  | 'pricing.update'
  | 'inventory.read'
  | 'inventory.update'
  | 'knowledge.read'
  | 'knowledge.create'
  | 'knowledge.update'
  | 'knowledge.approve'
  | 'settings.read'
  | 'settings.update';

export const InventoryStatusEnum = z.enum([
  'IN_STOCK',
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'ON_PRODUCTION',
  'UNKNOWN',
]);
export type InventoryStatus = z.infer<typeof InventoryStatusEnum>;

// ==========================================
// Schemas & Interfaces
// ==========================================

// Customer
export const CustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Customer name is required'),
  preferredLanguage: SupportedLanguageEnum.default('uz'),
  status: z.enum(['active', 'inactive', 'blocked']).default('active'),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const CreateCustomerSchema = CustomerSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateCustomer = z.infer<typeof CreateCustomerSchema>;

// Contact
export const ContactSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  channel: z.enum(['telegram', 'whatsapp', 'web', 'instagram']),
  externalId: z.string().min(1),
  username: z.string().optional(),
  phone: z.string().optional(),
  isPrimary: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Contact = z.infer<typeof ContactSchema>;

// Conversation
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  contactId: z.string().uuid(),
  status: ConversationStatusEnum.default('AI_ACTIVE'),
  channel: z.string(),
  lastMessageAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

// Manager
export const ManagerStatusEnum = z.enum(['ACTIVE', 'INACTIVE']);
export type ManagerStatus = z.infer<typeof ManagerStatusEnum>;

export const ManagerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Manager name is required'),
  role: z.string().default('Sotuv menejeri'),
  phone: z.string().optional(),
  telegramUsername: z.string().optional(),
  telegramChatId: z.string().optional(),
  status: ManagerStatusEnum.default('ACTIVE'),
  isOnDuty: z.boolean().default(false),
  specialties: z.array(z.string()).default([]),
  maxActiveLeads: z.number().int().default(20),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Manager = z.infer<typeof ManagerSchema>;

export const CreateManagerSchema = ManagerSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateManager = z.infer<typeof CreateManagerSchema>;

export type UpdateManager = Partial<Omit<Manager, 'id' | 'createdAt' | 'updatedAt'>>;

export interface ManagerWithStats extends Manager {
  totalLeads: number;
  qualifiedLeads: number;
  activeHandoffs: number;
  wonDeals: number;
  conversionRate: number;
}


// Message
export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderType: z.enum(['customer', 'ai', 'manager', 'system']),
  senderId: z.string().optional(),
  content: z.string().min(1),
  contentType: z.enum(['text', 'image', 'audio', 'document']).default('text'),
  status: MessageStatusEnum.default('RECEIVED'),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Message = z.infer<typeof MessageSchema>;

// Lead
export const LeadSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  score: z.number().min(0).max(100).default(0),
  temperature: LeadTemperatureEnum.default('COLD'),
  stage: z.enum(['new', 'qualifying', 'proposal', 'negotiation', 'won', 'lost']).default('new'),
  productInterest: z.string().optional(),
  estimatedValue: z.number().min(0).optional(),
  nextAction: z.string().optional(),
  assignedManagerId: z.string().uuid().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Lead = z.infer<typeof LeadSchema>;

// Handoff
export const HandoffSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  customerId: z.string().uuid(),
  reason: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status: z.enum(['PENDING', 'ACCEPTED', 'RESOLVED', 'REJECTED']).default('PENDING').optional(),
  notes: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  assignedManagerId: z.string().uuid().optional(),
  assignedAt: z.date().optional(),
  acceptedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Handoff = z.infer<typeof HandoffSchema>;

// Technical Specifications Schema (Polyester Yarn parameters)
export const TechnicalSpecificationValueSchema = z.object({
  value: z.union([z.number(), z.string()]),
  unit: z.string().nullable().optional(),
});
export type TechnicalSpecificationValue = z.infer<typeof TechnicalSpecificationValueSchema>;

export const TechnicalSpecificationsSchema = z.record(TechnicalSpecificationValueSchema);
export type TechnicalSpecifications = z.infer<typeof TechnicalSpecificationsSchema>;

// Product
export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Product name is required'),
  code: z.string().optional(),
  category: z.string().min(1),
  yarnType: z.string().optional(),
  count: z.string().optional(),
  composition: z.string().optional(),
  description: z.string(),
  price: z.number().min(0).default(0),
  currency: z.string().default('USD'),
  minimumOrder: z.number().min(1).default(1),
  stockStatus: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'pre_order']).default('in_stock'),
  media: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  aiRecommendable: z.boolean().default(true),
  technicalSpecifications: TechnicalSpecificationsSchema.optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CreateProductSchema = ProductSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateProduct = z.infer<typeof CreateProductSchema>;

export const PaymentTypeEnum = z.enum(['BANK_TRANSFER', 'CASH', 'LEGACY']);
export type PaymentType = z.infer<typeof PaymentTypeEnum>;

// Product Price Schema
export const ProductPriceSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  price: z.number().gt(0, 'Price must be greater than 0'),
  currency: z.string().default('USD'),
  paymentType: PaymentTypeEnum.default('LEGACY'),
  unit: z.string().default('kg'),
  minimumQuantity: z.number().gte(0).nullable().optional(),
  validFrom: z.date(),
  validUntil: z.date().optional(),
  active: z.boolean().default(true),
  notes: z.string().optional(),
  sourceSystem: z.string().optional(),
  externalRowId: z.string().optional(),
  sourceUpdatedAt: z.date().optional(),
  syncedAt: z.date().optional(),
  updatedBy: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ProductPrice = z.infer<typeof ProductPriceSchema>;

export const CreateProductPriceSchema = ProductPriceSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateProductPrice = z.infer<typeof CreateProductPriceSchema>;

// Google Sheets Sync State Schema
export const GoogleSheetsSyncStatusEnum = z.enum(['SUCCESS', 'FAILED', 'IN_PROGRESS']);
export type GoogleSheetsSyncStatus = z.infer<typeof GoogleSheetsSyncStatusEnum>;

export const GoogleSheetsSyncStateSchema = z.object({
  id: z.string().uuid(),
  spreadsheetId: z.string().min(1),
  status: GoogleSheetsSyncStatusEnum,
  lastAttemptAt: z.date(),
  lastSuccessAt: z.date().nullable().optional(),
  checksum: z.string().nullable().optional(),
  productsCount: z.number().int().default(0),
  pricesCount: z.number().int().default(0),
  inventoryCount: z.number().int().default(0),
  sanitizedError: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type GoogleSheetsSyncState = z.infer<typeof GoogleSheetsSyncStateSchema>;

// Product Inventory Schema
export const ProductInventorySchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  status: InventoryStatusEnum.default('IN_STOCK'),
  availableQuantity: z.number().gte(0, 'availableQuantity must be >= 0').default(0),
  reservedQuantity: z.number().gte(0, 'reservedQuantity must be >= 0').default(0),
  unit: z.string().default('kg'),
  warehouse: z.string().optional(),
  updatedBy: z.string().optional(),
  version: z.number().int().min(1).default(1),
  updatedAt: z.date(),
}).refine((data) => data.reservedQuantity <= data.availableQuantity, {
  message: 'reservedQuantity cannot exceed availableQuantity',
  path: ['reservedQuantity'],
});
export type ProductInventory = z.infer<typeof ProductInventorySchema>;

export const UpdateProductInventorySchema = z.object({
  status: InventoryStatusEnum.optional(),
  availableQuantity: z.number().gte(0).optional(),
  reservedQuantity: z.number().gte(0).optional(),
  unit: z.string().optional(),
  warehouse: z.string().optional(),
  updatedBy: z.string().optional(),
  expectedVersion: z.number().int().min(1).optional(),
});
export type UpdateProductInventory = z.infer<typeof UpdateProductInventorySchema>;

// Product Certificate Schema
export const ProductCertificateSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string().min(1),
  certificateNumber: z.string().min(1),
  issuer: z.string().min(1),
  validFrom: z.date(),
  validUntil: z.date().optional(),
  fileUrl: z.string().optional(),
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ProductCertificate = z.infer<typeof ProductCertificateSchema>;

export const CreateProductCertificateSchema = ProductCertificateSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateProductCertificate = z.infer<typeof CreateProductCertificateSchema>;

// Product Media Schema
export const ProductMediaSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  type: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'CATALOG', 'CERTIFICATE']),
  title: z.string().min(1),
  storageKey: z.string().min(1),
  mimeType: z.string().default('application/octet-stream'),
  active: z.boolean().default(true),
  createdAt: z.date(),
});
export type ProductMedia = z.infer<typeof ProductMediaSchema>;

export const CreateProductMediaSchema = ProductMediaSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateProductMedia = z.infer<typeof CreateProductMediaSchema>;

// Sales Settings Schema
export const SalesSettingsSchema = z.object({
  id: z.string().uuid(),
  delivery: z.object({
    regions: z.array(z.string()).default([]),
    countries: z.array(z.string()).default([]),
    estimatedDeliveryTime: z.string().default('3-7 business days'),
    deliveryTerms: z.string().default('FOB / EXW'),
    pickupAvailable: z.boolean().default(true),
    notes: z.string().optional(),
    active: z.boolean().default(true),
  }),
  payment: z.object({
    supportedCurrencies: z.array(z.string()).default(['USD', 'UZS']),
    paymentMethods: z.array(z.string()).default(['Bank Transfer', 'Letter of Credit']),
    prepaymentPercent: z.number().min(0).max(100).default(30),
    remainingPaymentRule: z.string().default('Before dispatch'),
    deferredPaymentAvailable: z.boolean().default(false),
    notes: z.string().optional(),
    active: z.boolean().default(true),
  }),
  updatedAt: z.date(),
});
export type SalesSettings = z.infer<typeof SalesSettingsSchema>;

export const UpdateSalesSettingsSchema = z.object({
  delivery: SalesSettingsSchema.shape.delivery.partial().optional(),
  payment: SalesSettingsSchema.shape.payment.partial().optional(),
});
export type UpdateSalesSettings = z.infer<typeof UpdateSalesSettingsSchema>;

// Audit Log Schema
export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  userRole: UserRoleEnum,
  action: z.string(),
  entity: z.string(),
  entityId: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  createdAt: z.date(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const CreateAuditLogSchema = AuditLogSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateAuditLog = z.infer<typeof CreateAuditLogSchema>;

// Knowledge Item
export const KnowledgeItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  language: SupportedLanguageEnum.default('uz'),
  status: KnowledgeStatusEnum.default('DRAFT'),
  source: z.string().optional(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
  validFrom: z.date().optional(),
  validUntil: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

export const CreateKnowledgeItemSchema = KnowledgeItemSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: KnowledgeStatusEnum.default('DRAFT'),
});
export type CreateKnowledgeItem = z.infer<typeof CreateKnowledgeItemSchema>;

export interface KnowledgeSearchResult {
  chunkId: string;
  knowledgeItemId: string;
  title: string;
  content: string;
  language: SupportedLanguage;
  source?: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface StructuredProductFact {
  id: string;
  name: string;
  code?: string;
  category?: string;
  description?: string;
  activePrice?: {
    amount: number;
    currency: string;
    unit: string;
    minimumQuantity?: number | null;
    validFrom: string;
    validUntil?: string;
  } | null;
  inventory?: {
    availableQuantity: number | null;
    reservedQuantity: number | null;
    netAvailable: number | null;
    status: ProductInventory['status'];
    warehouse?: string | null;
  } | null;
}

export interface StructuredBusinessFacts {
  products: StructuredProductFact[];
  salesSettings?: SalesSettings | null;
}

export interface KnowledgeSnippet {
  id: string;
  title: string;
  content: string;
  score?: number;
  source?: string;
}

export interface AIContext {
  customerId?: string;
  customerName?: string;
  conversationId?: string;
  preferredLanguage?: SupportedLanguage;
  isNewConversation?: boolean;
  conversationHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  availableProducts?: Product[];
  approvedKnowledgeItems?: KnowledgeSnippet[];
  knowledgeSnippets?: KnowledgeSnippet[];
  structuredBusinessFacts?: StructuredBusinessFacts;
  ragSources?: string[];
  retrievalMode?: 'pgvector' | 'memory-lexical' | 'none';
  lastResponse?: string;
}


// Telegram Business Connection
export const TelegramBusinessConnectionSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().min(1),
  businessUserId: z.string().min(1),
  userChatId: z.string().min(1),
  isEnabled: z.boolean().default(true),
  rights: z.record(z.unknown()).optional(),
  connectedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TelegramBusinessConnection = z.infer<typeof TelegramBusinessConnectionSchema>;

// Telegram Update Receipt
export const TelegramUpdateReceiptSchema = z.object({
  id: z.string().uuid(),
  updateId: z.number().int(),
  updateType: z.string(),
  status: z.enum(['PROCESSED', 'FAILED', 'SKIPPED']).default('PROCESSED'),
  errorCode: z.string().optional(),
  receivedAt: z.date(),
  processedAt: z.date(),
});
export type TelegramUpdateReceipt = z.infer<typeof TelegramUpdateReceiptSchema>;

// AI Structured Result Schema
export const AIStructuredResultSchema = z.object({
  replyText: z.string(),
  language: z.enum(['uz', 'uz-Latn', 'uz-Cyrl', 'ru', 'en', 'zh', 'tg', 'kk', 'ky']).default('uz'),
  intent: z.string().default('general_inquiry'),
  confidence: z.number().min(0).max(1).default(1.0),
  needsHandoff: z.boolean().default(false),
  handoffReason: z.string().optional(),
  leadSignals: z.object({
    productNeed: z.string().optional(),
    quantity: z.string().optional(),
    purchaseTime: z.string().optional(),
    region: z.string().optional(),
    budget: z.string().optional(),
    authority: z.string().optional(),
  }).default({}),
  usedKnowledgeIds: z.array(z.string()).default([]),
});
export type AIStructuredResult = z.infer<typeof AIStructuredResultSchema>;

// AI Usage Log Schema
export const AIUsageLogSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  estimatedCost: z.number().default(0),
  latencyMs: z.number().default(0),
  status: z.enum(['SUCCESS', 'FAILED', 'FALLBACK']),
  fallbackUsed: z.boolean().default(false),
  conversationId: z.string().optional(),
  createdAt: z.date(),
});
export type AIUsageLog = z.infer<typeof AIUsageLogSchema>;

// Dashboard Overview Types
export interface DashboardLeadSummary {
  totalLeads: number;
  totalLeadsPrev: number | null;
  totalLeadsChange: number | null;
  qualifiedLeads: number;
  qualifiedLeadsPrev: number | null;
  qualifiedLeadsChange: number | null;
  unqualifiedLeads: number;
  unqualifiedLeadsPrev: number | null;
  unqualifiedLeadsChange: number | null;
  unknownLeads: number;
  unknownLeadsPrev: number | null;
  unknownLeadsChange: number | null;
  aiProcessedLeads: number;
  aiProcessedLeadsPrev: number | null;
  aiProcessedLeadsChange: number | null;
  managerRoutedLeads: number;
  managerRoutedLeadsPrev: number | null;
  managerRoutedLeadsChange: number | null;
}

export interface DashboardAiSummary {
  aiProcessed: number;
  managerRouted: number;
  totalLeads: number;
  aiPercent: number;
  managerPercent: number;
}

export interface DashboardTopProduct {
  rank: number;
  name: string;
  code?: string;
  count: number;
  percentage: number;
}

export interface DashboardTopManager {
  id: string;
  name: string;
  totalLeads: number;
  qualifiedLeads: number;
  qualificationRate: number;
  meetingsOrOrders: number;
  conversionRate: number;
}

export type RecentLeadStatus =
  | 'NEW'
  | 'AI_PROCESSING'
  | 'QUALIFIED'
  | 'UNQUALIFIED'
  | 'WAITING_MANAGER'
  | 'CONTACTED'
  | 'CONVERTED';

export interface DashboardRecentLead {
  id: string;
  customerDisplayName: string;
  sanitizedPhone: string;
  requestedProduct: string;
  channel: string;
  status: RecentLeadStatus;
  manager: string;
  createdAt: string;
}

export interface DashboardCustomerSummary {
  totalCustomers: number;
  activeCustomers: number;
  repeatInquiries: number;
  conversionRate: number | null;
}

export interface DashboardResponseTime {
  avgResponseSeconds: number | null;
  formatted: string | null;
  sampleSize: number;
}

export interface DashboardOverviewData {
  period: {
    startDate?: string;
    endDate?: string;
    range: string;
  };
  leadSummary: DashboardLeadSummary;
  aiSummary: DashboardAiSummary;
  topProducts: DashboardTopProduct[];
  topManagers: DashboardTopManager[];
  recentLeads: DashboardRecentLead[];
  customerSummary: DashboardCustomerSummary;
  responseTime: DashboardResponseTime;
  samples: { count: number };
  offers: { count: number };
  meetings: { count: number };
  meta: {
    connected: boolean;
    message: string;
  } | null;
}

export * from './repositories.js';
