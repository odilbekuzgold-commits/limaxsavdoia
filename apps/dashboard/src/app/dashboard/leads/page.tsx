import { apiGet } from '../../../lib/api';
import { Empty, PageShell } from '../../../components/PageShell';

type Lead = { id: string; customerId: string; temperature?: string; stage?: string; score?: number };
export default async function LeadsPage() {
  let items: Lead[] = []; let error = '';
  try { items = (await apiGet<{ data: Lead[] }>('/api/v1/leads')).data; } catch (e) { error = e instanceof Error ? e.message : 'Yuklanmadi'; }
  return <PageShell title="Leadlar" description="Savdo signallari, harorat va pipeline bosqichlari.">{error&&<div className="data-error">{error}</div>}{items.length?<div className="table-wrap"><table><thead><tr><th>Mijoz</th><th>Harorat</th><th>Bosqich</th><th>Ball</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td>{x.customerId}</td><td><span className={`table-tag ${x.temperature?.toLowerCase()}`}>{x.temperature ?? 'COLD'}</span></td><td>{x.stage ?? 'NEW'}</td><td>{x.score ?? 0}</td></tr>)}</tbody></table></div>:!error&&<Empty>Yangi lead aniqlanganda shu yerda ko‘rinadi.</Empty>}</PageShell>;
}
