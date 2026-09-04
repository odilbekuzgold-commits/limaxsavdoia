export const dynamic = 'force-dynamic';

import { apiGet } from '../../../lib/api';
import { PageShell } from '../../../components/PageShell';
import {
  ConversationsClientContainer,
  type ConversationItem,
} from '../../../components/conversations/ConversationsClientContainer';

export default async function ConversationsPage() {
  let items: ConversationItem[] = [];
  let error = '';

  try {
    const res = await apiGet<{ data: ConversationItem[] }>('/api/v1/conversations');
    items = res.data || [];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Suhbatlar ro‘yxati yuklanmadi';
  }

  return (
    <PageShell
      title="Suhbatlar & Muloqotlar"
      description="Telegram kanallari orqali mijozlar bilan bo‘lgan barcha suhbatlar va xabarlar tarixi."
    >
      {error && <div className="data-error">{error}</div>}
      <ConversationsClientContainer initialConversations={items} />
    </PageShell>
  );
}
