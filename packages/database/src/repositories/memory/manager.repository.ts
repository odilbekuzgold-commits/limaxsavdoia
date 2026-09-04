import { randomUUID } from 'crypto';
import type {
  Manager,
  CreateManager,
  UpdateManager,
  ManagerStatus,
  IManagerRepository,
} from '@limax/shared';

export class InMemoryManagerRepository implements IManagerRepository {
  private db: Map<string, Manager> = new Map();

  constructor() {
    // Seed initial demo managers
    const now = new Date();
    const seeds: Manager[] = [
      {
        id: randomUUID(),
        name: 'Azizbek Karimov',
        role: 'Bosh sotuv menejeri',
        phone: '+998 90 912 34 56',
        telegramUsername: 'aziz_limax',
        status: 'ACTIVE',
        isOnDuty: true,
        specialties: ['Ip 30/70', 'Eksport', 'Katta buyurtmalar'],
        maxActiveLeads: 30,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        name: 'Dilshod Saidov',
        role: 'Eksport va VIP buyurtmalar menejeri',
        phone: '+998 97 765 43 21',
        telegramUsername: 'dilshod_limax',
        status: 'ACTIVE',
        isOnDuty: false,
        specialties: ['Eksport', 'Bo‘yalgan ip', 'To‘qimachilik korxonalari'],
        maxActiveLeads: 25,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: randomUUID(),
        name: 'Jamshid Qodirov',
        role: 'Ichki bozor va chakana savdo menejeri',
        phone: '+998 93 555 88 99',
        telegramUsername: 'jamshid_limax',
        status: 'ACTIVE',
        isOnDuty: false,
        specialties: ['Ichki bozor', 'Quti va namunalar', 'Yangi xaridorlar'],
        maxActiveLeads: 20,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const s of seeds) {
      this.db.set(s.id, s);
    }
  }

  async findAll(params?: { status?: ManagerStatus; onDutyOnly?: boolean }): Promise<Manager[]> {
    let list = Array.from(this.db.values());
    if (params?.status) {
      list = list.filter((m) => m.status === params.status);
    }
    if (params?.onDutyOnly) {
      list = list.filter((m) => m.isOnDuty);
    }
    return list.sort((a, b) => (b.isOnDuty ? 1 : 0) - (a.isOnDuty ? 1 : 0));
  }

  async findById(id: string): Promise<Manager | null> {
    return this.db.get(id) ?? null;
  }

  async create(data: CreateManager): Promise<Manager> {
    const now = new Date();
    const manager: Manager = {
      ...data,
      id: randomUUID(),
      role: data.role || 'Sotuv menejeri',
      status: data.status || 'ACTIVE',
      isOnDuty: data.isOnDuty ?? false,
      specialties: data.specialties || [],
      maxActiveLeads: data.maxActiveLeads || 20,
      createdAt: now,
      updatedAt: now,
    };
    this.db.set(manager.id, manager);
    return manager;
  }

  async update(id: string, data: UpdateManager): Promise<Manager | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Manager = {
      ...existing,
      ...data,
      id: existing.id,
      updatedAt: new Date(),
    };
    this.db.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.db.delete(id);
  }

  async setOnDuty(id: string, isOnDuty: boolean): Promise<Manager | null> {
    const existing = this.db.get(id);
    if (!existing) return null;
    const updated: Manager = {
      ...existing,
      isOnDuty,
      updatedAt: new Date(),
    };
    this.db.set(id, updated);
    return updated;
  }
}
