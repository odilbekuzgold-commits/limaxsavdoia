'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HeaderFilters, type FilterState } from './HeaderFilters';
import { KpiCards } from './KpiCards';
import { DonutCharts } from './DonutCharts';
import { TopProducts } from './TopProducts';
import { TopManagersTable } from './TopManagersTable';
import { RecentLeadsTable } from './RecentLeadsTable';
import { MetaStatsCard } from './MetaStatsCard';
import { BottomKpiPanel } from './BottomKpiPanel';
import type { DashboardOverviewData } from '@limax/shared';

interface DashboardClientContainerProps {
  initialData?: DashboardOverviewData | null;
  initialFilters: FilterState;
  apiOnline?: boolean;
}

export function DashboardClientContainer({
  initialData,
  initialFilters,
}: DashboardClientContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [filters, setFilters] = useState<FilterState>({
    lang: (searchParams.get('lang') as FilterState['lang']) || initialFilters.lang || 'uz',
    managerId: searchParams.get('managerId') || initialFilters.managerId || 'all',
    dateRange: (searchParams.get('dateRange') as FilterState['dateRange']) || initialFilters.dateRange || '30d',
  });

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    const params = new URLSearchParams();
    if (newFilters.lang) params.set('lang', newFilters.lang);
    if (newFilters.managerId) params.set('managerId', newFilters.managerId);
    if (newFilters.dateRange) params.set('dateRange', newFilters.dateRange);

    startTransition(() => {
      router.push(`/dashboard?${params.toString()}`);
    });
  };

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const data = initialData;
  const managerOptions = data?.topManagers
    ? data.topManagers.map((m) => ({ id: m.id, name: m.name }))
    : [];

  return (
    <>
      <HeaderFilters
        filters={filters}
        managerOptions={managerOptions}
        onChange={handleFilterChange}
        onRefresh={handleRefresh}
        loading={isPending}
      />

      {/* 5 KPI Cards */}
      <KpiCards summary={data?.leadSummary} loading={isPending} lang={filters.lang} />

      {/* 2 Donut Charts */}
      <DonutCharts
        leadSummary={data?.leadSummary}
        aiSummary={data?.aiSummary}
        loading={isPending}
      />

      {/* Top Products & Top Managers Row */}
      <div className="dashboard-row-2">
        <TopProducts products={data?.topProducts} loading={isPending} />
        <TopManagersTable managers={data?.topManagers} loading={isPending} />
      </div>

      {/* Recent Leads Table */}
      <div style={{ marginBottom: '24px' }}>
        <RecentLeadsTable leads={data?.recentLeads} loading={isPending} />
      </div>

      {/* Meta Advertising Integration Status */}
      <div style={{ marginBottom: '24px' }}>
        <MetaStatsCard meta={data?.meta} />
      </div>

      {/* Bottom 8 KPI Panel */}
      <BottomKpiPanel
        customerSummary={data?.customerSummary}
        responseTime={data?.responseTime}
        samples={data?.samples}
        offers={data?.offers}
        meetings={data?.meetings}
        loading={isPending}
        lang={filters.lang}
      />
    </>
  );
}
