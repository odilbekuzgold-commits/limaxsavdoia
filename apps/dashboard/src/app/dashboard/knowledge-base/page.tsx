import { apiGet } from '../../../lib/api';

type Knowledge = { id: string; title: string; language: string; status: string; validUntil?: string | null };

export default async function KnowledgeBasePage() {
  let items: Knowledge[] = [];
  let error = '';
  try { items = (await apiGet<{ data: Knowledge[] }>('/api/v1/knowledge')).data; }
  catch (err) { error = err instanceof Error ? err.message : 'Knowledge base could not be loaded'; }
  return <main style={{ padding: 24, fontFamily: 'sans-serif' }}><h1>Knowledge Base</h1><p>Only approved, valid items are authoritative for AI answers.</p>
    {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th>Title</th><th>Language</th><th>Status</th><th>Valid until</th></tr></thead>
      <tbody>{items.map((i) => <tr key={i.id}><td>{i.title}</td><td>{i.language}</td><td>{i.status}</td><td>{i.validUntil ?? '—'}</td></tr>)}</tbody></table>
    {!error && items.length === 0 && <p>No knowledge items yet.</p>}</main>;
}
