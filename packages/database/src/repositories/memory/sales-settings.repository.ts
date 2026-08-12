import { randomUUID } from 'crypto';
import type {
  SalesSettings,
  UpdateSalesSettings,
  ISalesSettingsRepository,
} from '@limax/shared';

export class InMemorySalesSettingsRepository implements ISalesSettingsRepository {
  private settings: SalesSettings = {
    id: randomUUID(),
    delivery: {
      regions: ['Tashkent', 'Samarkand', 'Fergana', 'Andijan', 'Namangan'],
      countries: ['Uzbekistan', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan'],
      estimatedDeliveryTime: '3-7 business days',
      deliveryTerms: 'FOB / EXW',
      pickupAvailable: true,
      notes: 'Standard B2B delivery terms',
      active: true,
    },
    payment: {
      supportedCurrencies: ['USD', 'UZS'],
      paymentMethods: ['Bank Transfer', 'Letter of Credit'],
      prepaymentPercent: 30,
      remainingPaymentRule: 'Before dispatch',
      deferredPaymentAvailable: false,
      notes: 'Standard payment policy',
      active: true,
    },
    updatedAt: new Date(),
  };

  async getSettings(): Promise<SalesSettings> {
    return this.settings;
  }

  async updateSettings(data: UpdateSalesSettings): Promise<SalesSettings> {
    this.settings = {
      ...this.settings,
      delivery: {
        ...this.settings.delivery,
        ...(data.delivery || {}),
      },
      payment: {
        ...this.settings.payment,
        ...(data.payment || {}),
      },
      updatedAt: new Date(),
    };
    return this.settings;
  }
}
