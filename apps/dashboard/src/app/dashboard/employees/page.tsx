export const dynamic = 'force-dynamic';

import { PageShell } from '../../../components/PageShell';
import {
  ManagersClientContainer,
  type ManagerItem,
} from '../../../components/employees/ManagersClientContainer';
import { apiGet } from '../../../lib/api';

export default async function EmployeesPage() {
  let managers: ManagerItem[] = [];
  let error = '';

  try {
    const res = await apiGet<{ data: ManagerItem[] }>('/api/v1/managers');
    managers = res.data || [];
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Menejerlar ro‘yxati yuklanmadi';
  }

  return (
    <PageShell
      title="Sotuv Menejerlari & Jamoa Boshqaruvi"
      description="Limax Yarn sotuv jamoasi tarkibi, navbatchilik holati, biriktirilgan leadlar va har bir menejerning KPI ko‘rsatkichlari."
    >
      {error && <div className="data-error">{error}</div>}
      <ManagersClientContainer initialManagers={managers} />
    </PageShell>
  );
}
