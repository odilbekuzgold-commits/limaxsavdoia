import { randomUUID } from 'crypto';
import type { Contact, IContactRepository } from '@limax/shared';

export class InMemoryContactRepository implements IContactRepository {
  private db: Map<string, Contact> = new Map();

  async findByCustomerId(customerId: string): Promise<Contact[]> {
    return Array.from(this.db.values()).filter((c) => c.customerId === customerId);
  }

  async findById(id: string): Promise<Contact | null> {
    return this.db.get(id) ?? null;
  }

  async findByChannelAndExternalId(channel: string, externalId: string): Promise<Contact | null> {
    for (const contact of this.db.values()) {
      if (contact.channel === channel && contact.externalId === externalId) return contact;
    }
    return null;
  }

  async create(data: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    const now = new Date();
    const contact: Contact = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.set(contact.id, contact);
    return contact;
  }

  async update(id: string, data: Partial<Contact>): Promise<Contact | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Contact = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  seed(contact: Contact): void {
    this.db.set(contact.id, contact);
  }
}
