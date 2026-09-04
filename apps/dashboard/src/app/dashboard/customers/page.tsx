export const dynamic = 'force-dynamic';
import { apiGet } from '../../../lib/api';
import { Empty, PageShell } from '../../../components/PageShell';

type Customer = {
  id: string;
  name?: string;
  phone?: string;
  preferredLanguage?: string;
  status?: string;
  createdAt?: string;
};

export default async function CustomersPage() {
  let items: Customer[] = [];
  let error = '';
  try {
    const res = await apiGet<{ data: Customer[] }>('/api/v1/customers');
    items = res.data || [];
  } catch (e) {
    error = e instanceof Error ? e.message : 'Yuklanmadi';
  }

  return (
    <PageShell
      title="Mijozlar"
      description="Telegram va boshqa kanallar orqali ro‘yxatga olingan mijozlar."
    >
      {error && <div className="data-error">{error}</div>}
      {items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ism / Foydalanuvchi</th>
                <th>Telefon</th>
                <th>Muloqot tili</th>
                <th>Holat</th>
                <th>Yaratilgan sana</th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td><b>{x.name || 'Noma’lum'}</b></td>
                  <td>{x.phone || '—'}</td>
                  <td>{x.preferredLanguage || 'uz'}</td>
                  <td><span className="table-tag">{x.status || 'active'}</span></td>
                  <td>{x.createdAt ? new Date(x.createdAt).toLocaleString('uz-UZ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !error && <Empty>Hozircha mijozlar mavjud emas.</Empty>
      )}
    </PageShell>
  );
}
