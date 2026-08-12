import { apiGet } from '../../../lib/api';

type Inventory = { id: string; productId: string; status: string; availableQuantity: number; reservedQuantity: number; unit: string; warehouse?: string };

export default async function InventoryPage() {
  let items: Inventory[] = [];
  let error = '';
  try { items = (await apiGet<{ data: Inventory[] }>('/api/v1/inventory')).data; }
  catch (err) { error = err instanceof Error ? err.message : 'Inventory could not be loaded'; }
  return <main style={{ padding: 24, fontFamily: 'sans-serif' }}><h1>Inventory</h1>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th>Product ID</th><th>Status</th><th>Available</th><th>Reserved</th><th>Net</th><th>Warehouse</th></tr></thead>
      <tbody>{items.map((i) => <tr key={i.id}><td>{i.productId}</td><td>{i.status}</td><td>{i.availableQuantity} {i.unit}</td><td>{i.reservedQuantity} {i.unit}</td><td>{i.availableQuantity - i.reservedQuantity} {i.unit}</td><td>{i.warehouse ?? '—'}</td></tr>)}</tbody></table>
    {!error && items.length === 0 && <p>No inventory records yet.</p>}</main>;
}
