'use client';

import type { DashboardLeadSummary } from '@limax/shared';

interface KpiCardsProps {
  summary?: DashboardLeadSummary;
  loading?: boolean;
  lang?: 'uz' | 'ru';
}

export function KpiCards({ summary, loading, lang = 'uz' }: KpiCardsProps) {
  const isRu = lang === 'ru';

  const cards = [
    {
      title: isRu ? 'Всего лидов' : 'Jami leadlar',
      value: summary?.totalLeads ?? 0,
      change: summary?.totalLeadsChange ?? null,
      icon: '📊',
      colorClass: 'emerald',
    },
    {
      title: isRu ? 'Качественные лиды' : 'Sifatli leadlar',
      value: summary?.qualifiedLeads ?? 0,
      change: summary?.qualifiedLeadsChange ?? null,
      icon: '🎯',
      colorClass: 'blue',
    },
    {
      title: isRu ? 'Некачественные лиды' : 'Sifatsiz leadlar',
      value: summary?.unqualifiedLeads ?? 0,
      change: summary?.unqualifiedLeadsChange ?? null,
      icon: '⚠️',
      colorClass: 'amber',
    },
    {
      title: isRu ? 'Обработано ИИ' : 'AI qayta ishlagan',
      value: summary?.aiProcessedLeads ?? 0,
      change: summary?.aiProcessedLeadsChange ?? null,
      icon: '🤖',
      colorClass: 'purple',
    },
    {
      title: isRu ? 'Передано менеджеру' : 'Menejerga yo‘naltirilgan',
      value: summary?.managerRoutedLeads ?? 0,
      change: summary?.managerRoutedLeadsChange ?? null,
      icon: '👤',
      colorClass: 'rose',
    },
  ];

  return (
    <div className={`kpi-grid-5 ${loading ? 'loading-skeleton' : ''}`}>
      {cards.map((c) => {
        let trendClass = 'neutral';
        let trendSymbol = '—';

        if (c.change !== null) {
          if (c.change > 0) {
            trendClass = 'up';
            trendSymbol = '▲';
          } else if (c.change < 0) {
            trendClass = 'down';
            trendSymbol = '▼';
          }
        }

        return (
          <div key={c.title} className="kpi-card">
            <div className="kpi-head">
              <span className="kpi-title">{c.title}</span>
              <div className={`kpi-icon-wrap ${c.colorClass}`}>{c.icon}</div>
            </div>

            <div className="kpi-value">{loading ? '...' : c.value.toLocaleString()}</div>

            <div className={`kpi-trend ${trendClass}`}>
              {c.change !== null ? (
                <>
                  <span>
                    {trendSymbol} {Math.abs(c.change)}%
                  </span>
                  <span className="kpi-trend-sub">
                    {isRu ? 'по сравнению с прошлым периодом' : 'oldingi davrga nisbatan'}
                  </span>
                </>
              ) : (
                <span className="kpi-trend-sub">
                  {isRu ? 'Нет данных для сравнения' : 'Taqqoslash uchun ma’lumot yo‘q'}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
