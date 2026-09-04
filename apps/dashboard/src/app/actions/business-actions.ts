'use server';

import { apiGet } from '../../lib/api';

export type BusinessActionResult<T = any> = {
  success: boolean;
  error?: string;
  data?: T;
};

export async function getConversationsAction(): Promise<BusinessActionResult<any[]>> {
  try {
    const res = await apiGet<{ data: any[] }>('/api/v1/conversations');
    return { success: true, data: res.data || [] };
  } catch (err: any) {
    return { success: false, error: err.message || 'Suhbatlar yuklanmadi' };
  }
}

export async function getConversationThreadAction(id: string): Promise<BusinessActionResult<any>> {
  try {
    const res = await apiGet<{ data: any }>(`/api/v1/conversations/${id}`);
    return { success: true, data: res.data };
  } catch (err: any) {
    return { success: false, error: err.message || 'Suhbat xabarlari yuklanmadi' };
  }
}


export async function createProductAction(_data: {
  code?: string;
  name: string;
  category?: string;
  description?: string;
  price?: number;
  currency?: string;
  active?: boolean;
}): Promise<BusinessActionResult> {
  return {
    success: false,
    error: 'Mahsulotlar faqat Google Sheets orqali boshqariladi (Dashboard read-only rejimida).',
  };
}

export async function updateProductAction(
  _id: string,
  _data: Record<string, unknown>
): Promise<BusinessActionResult> {
  return {
    success: false,
    error: 'Mahsulotlar faqat Google Sheets orqali yangilanadi (Dashboard read-only rejimida).',
  };
}

export async function toggleProductActiveAction(
  _id: string,
  _active: boolean
): Promise<BusinessActionResult> {
  return {
    success: false,
    error: 'Mahsulot holati faqat Google Sheets orqali oʻzgartiriladi (Dashboard read-only rejimida).',
  };
}

export async function createPriceAction(_data: {
  productId: string;
  amount: number;
  currency?: string;
  unit?: string;
  minimumQuantity?: number;
  validFrom?: string;
  validUntil?: string;
  notes?: string;
  active?: boolean;
}): Promise<BusinessActionResult> {
  return {
    success: false,
    error: 'Narxlar faqat Google Sheets orqali boshqariladi (Dashboard read-only rejimida).',
  };
}

export async function deactivatePriceAction(_priceId: string): Promise<BusinessActionResult> {
  return {
    success: false,
    error: 'Narxlar faqat Google Sheets orqali boshqariladi (Dashboard read-only rejimida).',
  };
}

export async function updateInventoryAction(
  _productId: string,
  _data?: {
    availableQuantity?: number;
    reservedQuantity?: number;
    unit?: string;
    warehouse?: string;
    status?: string;
    expectedVersion?: number;
  }
): Promise<BusinessActionResult> {
  return {
    success: false,
    error: 'Ombor qoldiqlari faqat Google Sheets orqali yangilanadi (Dashboard read-only rejimida).',
  };
}
