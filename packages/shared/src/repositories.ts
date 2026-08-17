import type {
  Customer,
  CreateCustomer,
  Contact,
  Conversation,
  Message,
  Lead,
  Handoff,
  Product,
  CreateProduct,
  ProductPrice,
  CreateProductPrice,
  ProductInventory,
  UpdateProductInventory,
  ProductCertificate,
  CreateProductCertificate,
  ProductMedia,
  CreateProductMedia,
  SalesSettings,
  UpdateSalesSettings,
  AuditLog,
  CreateAuditLog,
  KnowledgeItem,
  CreateKnowledgeItem,
  KnowledgeSearchResult,
  SupportedLanguage,
  LeadTemperature,
  KnowledgeStatus,
  TelegramBusinessConnection,
  TelegramUpdateReceipt,
  AIUsageLog,
} from './index.js';

// ==========================================
// Common Types
// ==========================================

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ==========================================
// Repository Interfaces
// ==========================================

export interface ICustomerRepository {
  findAll(params: { page: number; limit: number; search?: string }): Promise<PaginatedResult<Customer>>;
  findById(id: string): Promise<Customer | null>;
  create(data: CreateCustomer): Promise<Customer>;
  update(id: string, data: Partial<Customer>): Promise<Customer | null>;
}

export interface IContactRepository {
  findByCustomerId(customerId: string): Promise<Contact[]>;
  findById(id: string): Promise<Contact | null>;
  findByChannelAndExternalId(channel: string, externalId: string): Promise<Contact | null>;
  create(data: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact>;
  update(id: string, data: Partial<Contact>): Promise<Contact | null>;
}

export interface IConversationRepository {
  findAll(params: { status?: string }): Promise<Conversation[]>;
  findById(id: string): Promise<Conversation | null>;
  create(data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation>;
  update(id: string, data: Partial<Conversation>): Promise<Conversation | null>;
}

export interface IMessageRepository {
  findByConversationId(conversationId: string): Promise<Message[]>;
  create(data: Omit<Message, 'id' | 'createdAt' | 'updatedAt'>): Promise<Message>;
}

export interface ILeadRepository {
  findAll(params: { temperature?: LeadTemperature; stage?: string }): Promise<Lead[]>;
  findById(id: string): Promise<Lead | null>;
  create(data: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead>;
  update(id: string, data: Partial<Lead>): Promise<Lead | null>;
}

export interface IHandoffRepository {
  findByConversationId(conversationId: string): Promise<Handoff[]>;
  findById(id: string): Promise<Handoff | null>;
  create(data: Omit<Handoff, 'id' | 'createdAt' | 'updatedAt'>): Promise<Handoff>;
  update(id: string, data: Partial<Handoff>): Promise<Handoff | null>;
  claimManagerNotificationDelivery(id: string, timeoutMs?: number): Promise<boolean>;
}

export interface IProductRepository {
  findAll(params: { category?: string; activeOnly?: boolean }): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
  create(data: CreateProduct): Promise<Product>;
  update(id: string, data: Partial<Product>): Promise<Product | null>;
}

export interface IProductPriceRepository {
  findByProductId(productId: string): Promise<ProductPrice[]>;
  findActiveByProductId(productId: string, date?: Date): Promise<ProductPrice | null>;
  create(data: CreateProductPrice): Promise<ProductPrice>;
  update(id: string, data: Partial<ProductPrice>): Promise<ProductPrice | null>;
}

export interface IProductInventoryRepository {
  findByProductId(productId: string): Promise<ProductInventory | null>;
  findAll(): Promise<ProductInventory[]>;
  upsert(productId: string, data: UpdateProductInventory): Promise<ProductInventory>;
}

export interface IProductCertificateRepository {
  findByProductId(productId: string): Promise<ProductCertificate[]>;
  findActiveByProductId(productId: string, date?: Date): Promise<ProductCertificate[]>;
  create(data: CreateProductCertificate): Promise<ProductCertificate>;
}

export interface IProductMediaRepository {
  findByProductId(productId: string): Promise<ProductMedia[]>;
  create(data: CreateProductMedia): Promise<ProductMedia>;
}

export interface ISalesSettingsRepository {
  getSettings(): Promise<SalesSettings>;
  updateSettings(data: UpdateSalesSettings): Promise<SalesSettings>;
}

export interface IAuditLogRepository {
  create(data: CreateAuditLog): Promise<AuditLog>;
  findAll(params: { page: number; limit: number; entity?: string }): Promise<PaginatedResult<AuditLog>>;
}

export interface IKnowledgeRepository {
  findAll(params: { language?: SupportedLanguage; status?: KnowledgeStatus }): Promise<KnowledgeItem[]>;
  findById(id: string): Promise<KnowledgeItem | null>;
  findByIdForUpdate(id: string): Promise<KnowledgeItem | null>;
  create(data: CreateKnowledgeItem): Promise<KnowledgeItem>;
  update(id: string, data: Partial<KnowledgeItem>): Promise<KnowledgeItem | null>;
  searchSimilar(
    embedding: number[],
    options: {
      language?: SupportedLanguage;
      topK: number;
      minScore: number;
      now: Date;
    }
  ): Promise<KnowledgeSearchResult[]>;
  replaceChunks(
    knowledgeItemId: string,
    chunks: Array<{
      chunkIndex: number;
      content: string;
      language?: SupportedLanguage;
      embedding?: number[];
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface ITelegramBusinessConnectionRepository {
  findByConnectionId(connectionId: string): Promise<TelegramBusinessConnection | null>;
  findByBusinessUserId(businessUserId: string): Promise<TelegramBusinessConnection | null>;
  upsert(data: Omit<TelegramBusinessConnection, 'id' | 'createdAt' | 'updatedAt'>): Promise<TelegramBusinessConnection>;
  countActive(): Promise<number>;
  countTotal(): Promise<number>;
}

export interface ITelegramUpdateReceiptRepository {
  findByUpdateId(updateId: number): Promise<TelegramUpdateReceipt | null>;
  create(data: Omit<TelegramUpdateReceipt, 'id' | 'receivedAt' | 'processedAt'>): Promise<TelegramUpdateReceipt>;
  getLastUpdateAt(): Promise<Date | null>;
  getLastErrorCode(): Promise<string | null>;
}

export interface IAIUsageRepository {
  create(data: Omit<AIUsageLog, 'id' | 'createdAt'>): Promise<AIUsageLog>;
  findByConversationId(conversationId: string): Promise<AIUsageLog[]>;
}

// ==========================================
// Repositories Container
// ==========================================

export interface Repositories {
  customers: ICustomerRepository;
  contacts: IContactRepository;
  conversations: IConversationRepository;
  messages: IMessageRepository;
  leads: ILeadRepository;
  handoffs: IHandoffRepository;
  products: IProductRepository;
  productPrices: IProductPriceRepository;
  productInventory: IProductInventoryRepository;
  productCertificates: IProductCertificateRepository;
  productMedia: IProductMediaRepository;
  salesSettings: ISalesSettingsRepository;
  auditLogs: IAuditLogRepository;
  knowledge: IKnowledgeRepository;
  telegramConnections: ITelegramBusinessConnectionRepository;
  telegramReceipts: ITelegramUpdateReceiptRepository;
  aiUsage: IAIUsageRepository;
}
