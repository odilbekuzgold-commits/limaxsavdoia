import { randomUUID } from 'crypto';
import type { Lead, LeadTemperature, ILeadRepository } from '@limax/shared';

export class InMemoryLeadRepository implements ILeadRepository {
  private db: Map<string, Lead> = new Map();

  async findAll(params: { temperature?: LeadTemperature; stage?: string }): Promise<Lead[]> {
    return Array.from(this.db.values()).filter((lead) => {
      const tempMatch = params.temperature ? lead.temperature === params.temperature : true;
      const stageMatch = params.stage ? lead.stage === params.stage : true;
      return tempMatch && stageMatch;
    });
  }

  async findById(id: string): Promise<Lead | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Promise<Lead> {
    const now = new Date();
    const lead: Lead = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.db.set(lead.id, lead);
    return lead;
  }

  async update(id: string, data: Partial<Lead>): Promise<Lead | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Lead = { ...existing, ...data, id: existing.id, updatedAt: new Date() };
    this.db.set(id, updated);
    return updated;
  }

  seed(lead: Lead): void {
    this.db.set(lead.id, lead);
  }
}
