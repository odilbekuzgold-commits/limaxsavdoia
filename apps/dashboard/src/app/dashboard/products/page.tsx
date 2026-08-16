import { apiGet } from '../../../lib/api';
import { PageShell } from '../../../components/PageShell';
import { ProductsClientContainer, type ProductItem, type PriceRecord } from '../../../components/products/ProductsClientContainer';

export default async function ProductsPage() {
  let products: ProductItem[] = [];
  const pricesMap: Record<string, PriceRecord[]> = {};
  let error = '';

  try {
    const productsRes = await apiGet<{ data: ProductItem[] }>('/api/v1/products');
    products = productsRes.data || [];

    // Load price history for each product
    for (const p of products) {
      try {
        const pricesRes = await apiGet<{ data: PriceRecord[] }>(`/api/v1/pricing?productId=${p.id}`);
        pricesMap[p.id] = pricesRes.data || [];
      } catch {
        pricesMap[p.id] = [];
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Mahsulotlar katalogi yuklanmadi';
  }

  return (
    <PageShell title="Mahsulotlar Katalogi & Narxlar" description="Mahsulotlar kiritish, tahrirlash, active status va amaldagi narxlarni boshqarish.">
      {error && <div className="data-error">{error}</div>}
      <ProductsClientContainer initialProducts={products} initialPrices={pricesMap} />
    </PageShell>
  );
}
