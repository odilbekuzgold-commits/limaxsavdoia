'use client';

import type { DashboardTopManager } from '@limax/shared';

interface TopManagersTableProps {
  managers?: DashboardTopManager[];
  loading?: boolean;
}

export function TopManagersTable({ managers = [], loading }: TopManagersTableProps) {
  return (
    <div className={`panel-card ${loading ? 'loading-skeleton' : ''}`}>
      <div className="panel-head">
        <div>
          <h3>Top menejerlar ko‘rsatkichlari</h3>
          <p>Menejerlar bo‘yicha leadlarni qayta ishlash va konversiya samaradorligi</p>
        </div>
      </div>

      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Menejer</th>
              <th>Jami leadlar</th>
              <th>Sifatli leadlar</th>
              <th>Kvalifikatsiya %</th>
              <th>Uchrashuv / Buyurtmalar</th>
              <th>Konversiya %</th>
            </tr>
          </thead>
          <tbody>
            {managers.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                  Menejerlar statistikasi mavjud emas
                </td>
              </tr>
            ) : (
              managers.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: '#ecfdf5',
                          color: '#059669',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 700,
                          fontSize: '12px',
                        }}
                      >
                        {m.name.slice(0, 1)}
                      </div>
                      <strong style={{ color: 'var(--text-main)' }}>{m.name}</strong>
                    </div>
                  </td>
                  <td><strong>{m.totalLeads}</strong></td>
                  <td><span style={{ color: '#059669', fontWeight: 700 }}>{m.qualifiedLeads}</span></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div className="product-bar-bg" style={{ width: '50px', height: '6px' }}>
                        <div className="product-bar-fill" style={{ width: `${m.qualificationRate}%` }} />
                      </div>
                      <span>{m.qualificationRate}%</span>
                    </div>
                  </td>
                  <td><strong>{m.meetingsOrOrders}</strong></td>
                  <td>
                    <span style={{ fontWeight: 700, color: m.conversionRate > 20 ? '#059669' : 'var(--text-main)' }}>
                      {m.conversionRate}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
