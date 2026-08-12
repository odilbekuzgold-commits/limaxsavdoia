import { apiGet } from '../../../lib/api';

type Product = { id: string; name: string; code?: string; category?: string; active: boolean; aiRecommendable?: boolean };

export default async function ProductsPage() {
  let products: Product[] = [];
  let error = '';
  try { products = (await apiGet<{ data: Product[] }>('/api/v1/products')).data; }
  catch (err) { error = err instanceof Error ? err.message : 'Products could not be loaded'; }
  return <main style={{ padding: 24, fontFamily: 'sans-serif' }}><h1>Products</h1><p>PostgreSQL structured product catalogue.</p>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Status</th><th>AI</th></tr></thead>
      <tbody>{products.map((p) => <tr key={p.id}><td>{p.code ?? '—'}</td><td>{p.name}</td><td>{p.category ?? '—'}</td><td>{p.active ? 'ACTIVE' : 'INACTIVE'}</td><td>{p.aiRecommendable ? 'ENABLED' : 'DISABLED'}</td></tr>)}</tbody></table>
    {!error && products.length === 0 && <p>No products yet.</p>}</main>;
}
