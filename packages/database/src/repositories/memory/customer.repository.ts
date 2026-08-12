import { randomUUID } from 'crypto';
import type {
  Customer,
  CreateCustomer,
  ICustomerRepository,
  PaginatedResult,
} from '@limax/shared';

export class InMemoryCustomerRepository implements ICustomerRepository {
  private db: Map<string, Customer> = new Map();

  async findAll(params: { page: number; limit: number; search?: string }): Promise<PaginatedResult<Customer>> {
    const { page, limit, search } = params;
    const lower = (search || '').toLowerCase();
    const all = Array.from(this.db.values()).filter((c) =>
      lower ? c.name.toLowerCase().includes(lower) || c.tags.some((t: string) => t.toLowerCase().includes(lower)) : true
    );
    const total = all.length;
    const data = all.slice((page - 1) * limit, page * limit);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async findById(id: string): Promise<Customer | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: CreateCustomer): Promise<Customer> {
    const now = new Date();
    const customer: Customer = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.set(customer.id, customer);
    return customer;
  }

  async update(id: string, data: Partial<Customer>): Promise<Customer | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Customer = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  /** Seed data for development/testing */
  seed(customer: Customer): void {
    this.db.set(customer.id, customer);
  }
}
