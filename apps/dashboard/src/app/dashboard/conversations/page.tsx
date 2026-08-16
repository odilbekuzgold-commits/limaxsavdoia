import { apiGet } from '../../../lib/api';
import { Empty, PageShell } from '../../../components/PageShell';

type Conversation = { id: string; customerId: string; channel?: string; status: string; lastMessageAt?: string };
export default async function ConversationsPage() {
  let items: Conversation[] = []; let error = '';
  try { items = (await apiGet<{ data: Conversation[] }>('/api/v1/conversations')).data; } catch (e) { error = e instanceof Error ? e.message : 'Yuklanmadi'; }
  return <PageShell title="Suhbatlar" description="Telegram va boshqa kanallardagi mijoz suhbatlari.">{error && <div className="data-error">{error}</div>}{items.length ? <div className="table-wrap"><table><thead><tr><th>Mijoz</th><th>Kanal</th><th>Status</th><th>Oxirgi xabar</th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td>{x.customerId}</td><td>{x.channel ?? 'telegram'}</td><td><span className="table-tag">{x.status}</span></td><td>{x.lastMessageAt ? new Date(x.lastMessageAt).toLocaleString('uz-UZ') : '—'}</td></tr>)}</tbody></table></div>:!error&&<Empty>Bot xabar qabul qilganda suhbatlar shu yerda paydo bo‘ladi.</Empty>}</PageShell>;
}
