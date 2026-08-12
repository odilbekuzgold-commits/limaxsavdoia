import { apiGet } from '../../../../lib/api';

export default async function SalesSettingsPage() {
  let settings: Record<string, unknown> | null = null;
  let error = '';
  try { settings = (await apiGet<{ data: Record<string, unknown> }>('/api/v1/settings/sales')).data; }
  catch (err) { error = err instanceof Error ? err.message : 'Sales settings could not be loaded'; }
  return <main style={{ padding: 24, fontFamily: 'sans-serif' }}><h1>Sales & Delivery Settings</h1>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    {settings ? <dl>{Object.entries(settings).filter(([key]) => key !== 'id').map(([key, value]) => <div key={key} style={{ marginBottom: 12 }}><dt style={{ fontWeight: 700 }}>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}</dl> : !error && <p>No settings configured.</p>}</main>;
}
