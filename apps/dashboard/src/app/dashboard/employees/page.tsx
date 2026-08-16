import { PageShell } from '../../../components/PageShell';
import { TopManagersTable } from '../../../components/analytics/TopManagersTable';
import { apiGet } from '../../../lib/api';
import type { DashboardOverviewData, DashboardTopManager } from '@limax/shared';

export default async function EmployeesPage() {
  let managers: DashboardTopManager[] = [];
  try {
    const overview = await apiGet<{ data: DashboardOverviewData }>('/api/v1/dashboard/overview');
    managers = overview.data.topManagers;
  } catch {
    // fallback
  }

  return (
    <PageShell title="Menejerlar" description="Sotuv menejerlari ro‘yxati va ularning KPI ko‘rsatkichlari">
      <TopManagersTable managers={managers} />
    </PageShell>
  );
}
