'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiPatch, apiPut } from '../../lib/api';

export async function createProductAction(data: {
  code?: string;
  name: string;
  category?: string;
  description?: string;
  price?: number;
  currency?: string;
  active?: boolean;
}) {
  try {
    const res = await apiPost<{ data: unknown }>('/api/v1/products', data);
    revalidatePath('/dashboard/products');
    revalidatePath('/dashboard/inventory');
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateProductAction(id: string, data: Record<string, unknown>) {
  try {
    const res = await apiPatch<{ data: unknown }>(`/api/v1/products/${id}`, data);
    revalidatePath('/dashboard/products');
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function toggleProductActiveAction(id: string, active: boolean) {
  try {
    const endpoint = active ? `/api/v1/products/${id}/activate` : `/api/v1/products/${id}/deactivate`;
    const res = await apiPost<{ data: unknown }>(endpoint);
    revalidatePath('/dashboard/products');
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createPriceAction(data: {
  productId: string;
  amount: number;
  currency?: string;
  unit?: string;
  minimumQuantity?: number;
  validFrom?: string;
  validUntil?: string;
  notes?: string;
  active?: boolean;
}) {
  try {
    const res = await apiPost<{ data: unknown }>('/api/v1/pricing', data);
    revalidatePath('/dashboard/products');
    revalidatePath('/dashboard/settings/sales');
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deactivatePriceAction(priceId: string) {
  try {
    const res = await apiPost<{ data: unknown }>(`/api/v1/pricing/${priceId}/deactivate`);
    revalidatePath('/dashboard/products');
    revalidatePath('/dashboard/settings/sales');
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateInventoryAction(productId: string, data: {
  availableQuantity: number;
  reservedQuantity: number;
  unit?: string;
  warehouse?: string;
  status?: string;
  expectedVersion?: number;
}) {
  try {
    const res = await apiPut<{ data: unknown }>(`/api/v1/inventory/${productId}`, data);
    revalidatePath('/dashboard/inventory');
    revalidatePath('/dashboard/products');
    return { success: true, data: res.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('409') || msg.includes('version conflict') || msg.includes('INVENTORY_VERSION_CONFLICT')) {
      return { success: false, error: 'Ma’lumot boshqa sessiyada yangilangan. Sahifani yangilang.' };
    }
    return { success: false, error: msg };
  }
}
