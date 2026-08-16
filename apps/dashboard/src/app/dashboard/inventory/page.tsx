import { apiGet } from '../../../lib/api';
import { PageShell } from '../../../components/PageShell';
import { InventoryClientContainer, type ProductItem, type InventoryItem } from '../../../components/inventory/InventoryClientContainer';

export default async function InventoryPage() {
  let products: ProductItem[] = [];
  let inventory: InventoryItem[] = [];
  let error = '';

  try {
    const [prodRes, invRes] = await Promise.all([
      apiGet<{ data: ProductItem[] }>('/api/v1/products'),
      apiGet<{ data: InventoryItem[] }>('/api/v1/inventory'),
    ]);
    products = prodRes.data || [];
    inventory = invRes.data || [];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Ombor ma’lumotlari yuklanmadi';
  }

  return (
    <PageShell title="Ombor Qoldiqlari Boshqaruvi" description="Real-time qoldiq (available), rezerv (reserved) va sof qoldiq hisob-kitobi.">
      {error && <div className="data-error">{error}</div>}
      <InventoryClientContainer initialProducts={products} initialInventory={inventory} />
    </PageShell>
  );
}
