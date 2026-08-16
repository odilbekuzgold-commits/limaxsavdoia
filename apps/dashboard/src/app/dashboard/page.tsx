import { apiGet } from '../../lib/api';
import { Sidebar } from '../../components/layout/Sidebar';
import { DashboardClientContainer } from '../../components/analytics/DashboardClientContainer';
import type { DashboardOverviewData } from '@limax/shared';

export const dynamic = 'force-dynamic';

interface SearchParams {
  lang?: string;
  managerId?: string;
  dateRange?: string;
}

async function safeGetOverview(params: SearchParams): Promise<{ data: DashboardOverviewData | null; ok: boolean }> {
  try {
    const query = new URLSearchParams();
    if (params.lang) query.set('lang', params.lang);
    if (params.managerId) query.set('managerId', params.managerId);
    if (params.dateRange) query.set('dateRange', params.dateRange);

    const res = await apiGet<{ data: DashboardOverviewData }>(`/api/v1/dashboard/overview?${query.toString()}`);
    return { data: res.data, ok: true };
  } catch {
    return { data: null, ok: false };
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedParams = (await searchParams) || {};
  const { data, ok } = await safeGetOverview(resolvedParams);

  const filterState = {
    lang: (resolvedParams.lang as 'uz' | 'ru') || 'uz',
    managerId: resolvedParams.managerId || 'all',
    dateRange: (resolvedParams.dateRange as 'today' | '7d' | '30d' | 'month' | 'all') || '30d',
  };

  return (
    <div className="app-shell">
      <Sidebar apiOnline={ok} />

      <main className="workspace">
        <DashboardClientContainer
          initialData={data}
          initialFilters={filterState}
          apiOnline={ok}
        />
      </main>
    </div>
  );
}
