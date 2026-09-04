'use server';

import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '../../lib/api';

export type BusinessActionResult<T = unknown> = {
  success: boolean;
  error?: string;
  data?: T;
};

export async function getConversationsAction(): Promise<BusinessActionResult<any[]>> {
  try {
    const res = await apiGet<{ data: any[] }>('/api/v1/conversations');
    return { success: true, data: res.data || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Suhbatlar yuklanmadi';
    return { success: false, error: message };
  }
}

export async function getConversationThreadAction(id: string): Promise<BusinessActionResult<any>> {
  try {
    const res = await apiGet<{ data: any }>(`/api/v1/conversations/${id}`);
    return { success: true, data: res.data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Suhbat xabarlari yuklanmadi';
    return { success: false, error: message };
  }
}

export async function getManagersAction(): Promise<BusinessActionResult<any[]>> {
  try {
    const res = await apiGet<{ data: any[] }>('/api/v1/managers');
    return { success: true, data: res.data || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Menejerlar ro‘yxati yuklanmadi';
    return { success: false, error: message };
  }
}

export async function createManagerAction(data: {
  name: string;
  role?: string;
  phone?: string;
  telegramUsername?: string;
  specialties?: string[];
  isOnDuty?: boolean;
}): Promise<BusinessActionResult<any>> {
  try {
    const res = await apiPost<{ data: any }>('/api/v1/managers', data);
    return { success: true, data: res.data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Menejer qo‘shishda xatolik yuz berdi';
    return { success: false, error: message };
  }
}

export async function updateManagerAction(
  id: string,
  data: Record<string, unknown>
): Promise<BusinessActionResult<any>> {
  try {
    const res = await apiPut<{ data: any }>(`/api/v1/managers/${id}`, data);
    return { success: true, data: res.data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Menejer ma‘lumotlarini yangilab bo‘lmadi';
    return { success: false, error: message };
  }
}

export async function toggleManagerDutyAction(
  id: string,
  isOnDuty?: boolean
): Promise<BusinessActionResult<any>> {
  try {
    const res = await apiPatch<{ data: any }>(`/api/v1/managers/${id}/toggle-duty`, { isOnDuty });
    return { success: true, data: res.data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Navbatchilik holatini o‘zgartirib bo‘lmadi';
    return { success: false, error: message };
  }
}

export async function deleteManagerAction(id: string): Promise<BusinessActionResult> {
  try {
    await apiDelete(`/api/v1/managers/${id}`);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Menejerni o‘chirib bo‘lmadi';
    return { success: false, error: message };
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
