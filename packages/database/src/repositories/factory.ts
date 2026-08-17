import type pg from 'pg';
import type { Repositories } from '@limax/shared';
import {
  InMemoryCustomerRepository,
  InMemoryContactRepository,
  InMemoryConversationRepository,
  InMemoryMessageRepository,
  InMemoryLeadRepository,
  InMemoryHandoffRepository,
  InMemoryProductRepository,
  InMemoryKnowledgeRepository,
  InMemoryTelegramBusinessConnectionRepository,
  InMemoryTelegramUpdateReceiptRepository,
  InMemoryAIUsageRepository,
  InMemoryProductPriceRepository,
  InMemoryProductInventoryRepository,
  InMemoryProductCertificateRepository,
  InMemoryProductMediaRepository,
  InMemorySalesSettingsRepository,
  InMemoryAuditLogRepository,
} from './memory/index.js';
import {
  PgCustomerRepository,
  PgContactRepository,
  PgConversationRepository,
  PgMessageRepository,
  PgLeadRepository,
  PgHandoffRepository,
  PgProductRepository,
  PgKnowledgeRepository,
  PgTelegramBusinessConnectionRepository,
  PgTelegramUpdateReceiptRepository,
  PgAIUsageRepository,
  PgProductPriceRepository,
  PgProductInventoryRepository,
  PgProductCertificateRepository,
  PgProductMediaRepository,
  PgSalesSettingsRepository,
  PgAuditLogRepository,
} from './pg/index.js';

export type RepositoryDriver = 'memory' | 'postgres';

export function createRepositories(driver: RepositoryDriver, pool?: pg.Pool | pg.PoolClient): Repositories {
  if (driver === 'postgres') {
    if (!pool) {
      throw new Error('PostgreSQL pool or PoolClient is required when using postgres driver');
    }
    return {
      customers: new PgCustomerRepository(pool),
      contacts: new PgContactRepository(pool),
      conversations: new PgConversationRepository(pool),
      messages: new PgMessageRepository(pool),
      leads: new PgLeadRepository(pool),
      handoffs: new PgHandoffRepository(pool),
      products: new PgProductRepository(pool),
      productPrices: new PgProductPriceRepository(pool),
      productInventory: new PgProductInventoryRepository(pool),
      productCertificates: new PgProductCertificateRepository(pool),
      productMedia: new PgProductMediaRepository(pool),
      salesSettings: new PgSalesSettingsRepository(pool),
      auditLogs: new PgAuditLogRepository(pool),
      knowledge: new PgKnowledgeRepository(pool),
      telegramConnections: new PgTelegramBusinessConnectionRepository(pool),
      telegramReceipts: new PgTelegramUpdateReceiptRepository(pool),
      aiUsage: new PgAIUsageRepository(pool),
    };
  }

  if (driver === 'memory') {
    const products = new InMemoryProductRepository();
    return {
      customers: new InMemoryCustomerRepository(),
      contacts: new InMemoryContactRepository(),
      conversations: new InMemoryConversationRepository(),
      messages: new InMemoryMessageRepository(),
      leads: new InMemoryLeadRepository(),
      handoffs: new InMemoryHandoffRepository(),
      products,
      productPrices: new InMemoryProductPriceRepository(products),
      productInventory: new InMemoryProductInventoryRepository(products),
      productCertificates: new InMemoryProductCertificateRepository(),
      productMedia: new InMemoryProductMediaRepository(),
      salesSettings: new InMemorySalesSettingsRepository(),
      auditLogs: new InMemoryAuditLogRepository(),
      knowledge: new InMemoryKnowledgeRepository(),
      telegramConnections: new InMemoryTelegramBusinessConnectionRepository(),
      telegramReceipts: new InMemoryTelegramUpdateReceiptRepository(),
      aiUsage: new InMemoryAIUsageRepository(),
    };
  }

  throw new Error(`Unknown repository driver: '${driver}'. Valid values: 'memory', 'postgres'`);
}
