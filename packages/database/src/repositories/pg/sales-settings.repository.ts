import type pg from 'pg';
import type {
  SalesSettings,
  UpdateSalesSettings,
  ISalesSettingsRepository,
} from '@limax/shared';

export class PgSalesSettingsRepository implements ISalesSettingsRepository {
  constructor(private pool: pg.Pool) {}

  async getSettings(): Promise<SalesSettings> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT id, delivery, payment, updated_at FROM sales_settings LIMIT 1'
    );
    if (result.rows[0]) {
      return this.mapRow(result.rows[0]);
    }
    // Return default settings
    return {
      id: '00000000-0000-0000-0000-000000000000',
      delivery: {
        regions: ['Tashkent', 'Samarkand', 'Fergana', 'Andijan', 'Namangan'],
        countries: ['Uzbekistan', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan'],
        estimatedDeliveryTime: '3-7 business days',
        deliveryTerms: 'FOB / EXW',
        pickupAvailable: true,
        active: true,
      },
      payment: {
        supportedCurrencies: ['USD', 'UZS'],
        paymentMethods: ['Bank Transfer', 'Letter of Credit'],
        prepaymentPercent: 30,
        remainingPaymentRule: 'Before dispatch',
        deferredPaymentAvailable: false,
        active: true,
      },
      updatedAt: new Date(),
    };
  }

  async updateSettings(data: UpdateSalesSettings): Promise<SalesSettings> {
    const current = await this.getSettings();
    const updatedDelivery = { ...current.delivery, ...(data.delivery || {}) };
    const updatedPayment = { ...current.payment, ...(data.payment || {}) };

    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO sales_settings (id, delivery, payment, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         delivery = $2,
         payment = $3,
         updated_at = NOW()
       RETURNING id, delivery, payment, updated_at`,
      [current.id, JSON.stringify(updatedDelivery), JSON.stringify(updatedPayment)]
    );
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: Record<string, unknown>): SalesSettings {
    return {
      id: row.id as string,
      delivery: (typeof row.delivery === 'string' ? JSON.parse(row.delivery) : row.delivery) as SalesSettings['delivery'],
      payment: (typeof row.payment === 'string' ? JSON.parse(row.payment) : row.payment) as SalesSettings['payment'],
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
