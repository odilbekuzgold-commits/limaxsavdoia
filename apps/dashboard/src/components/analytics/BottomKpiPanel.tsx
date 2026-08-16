'use client';

import type { DashboardCustomerSummary, DashboardResponseTime } from '@limax/shared';

interface BottomKpiPanelProps {
  customerSummary?: DashboardCustomerSummary;
  responseTime?: DashboardResponseTime;
  samples?: { count: number };
  offers?: { count: number };
  meetings?: { count: number };
  loading?: boolean;
  lang?: 'uz' | 'ru';
}

export function BottomKpiPanel({
  customerSummary,
  responseTime,
  samples,
  offers,
  meetings,
  loading,
  lang = 'uz',
}: BottomKpiPanelProps) {
  const isRu = lang === 'ru';
  const noDataText = isRu ? 'Нет данных' : 'Ma’lumot yo‘q';

  const conversionStr =
    customerSummary?.conversionRate !== null && customerSummary?.conversionRate !== undefined
      ? `${customerSummary.conversionRate}%`
      : noDataText;

  const responseTimeStr = responseTime?.formatted ? responseTime.formatted : noDataText;

  const items = [
    { label: isRu ? 'Всего клиентов' : 'Jami mijozlar', value: customerSummary?.totalCustomers ?? 0, icon: '👥' },
    { label: isRu ? 'Активные клиенты' : 'Faol mijozlar', value: customerSummary?.activeCustomers ?? 0, icon: '⚡' },
    { label: isRu ? 'Повторные обращения' : 'Qayta murojaatlar', value: customerSummary?.repeatInquiries ?? 0, icon: '🔄' },
    { label: isRu ? 'Конверсия' : 'Konversiya', value: conversionStr, icon: '📈' },
    { label: isRu ? 'Среднее время ответа' : 'O‘rtacha javob vaqti', value: responseTimeStr, icon: '⏱️' },
    { label: isRu ? 'Запросы образцов' : 'Namuna so‘rovlari', value: samples?.count ?? 0, icon: '📦' },
    { label: isRu ? 'Отправлено КП' : 'Taklif yuborilganlar', value: offers?.count ?? 0, icon: '📜' },
    { label: isRu ? 'Встречи' : 'Uchrashuvlar', value: meetings?.count ?? 0, icon: '🤝' },
  ];

  return (
    <div className={`bottom-kpi-grid ${loading ? 'loading-skeleton' : ''}`}>
      {items.map((item) => (
        <div key={item.label} className="bottom-kpi-card">
          <div className="bottom-kpi-icon">{item.icon}</div>
          <div className="bottom-kpi-data">
            <small>{item.label}</small>
            <strong>{loading ? '...' : item.value}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}
