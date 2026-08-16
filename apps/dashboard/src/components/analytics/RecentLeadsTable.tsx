'use client';

import type { DashboardRecentLead, RecentLeadStatus } from '@limax/shared';

interface RecentLeadsTableProps {
  leads?: DashboardRecentLead[];
  loading?: boolean;
}

const STATUS_CONFIG: Record<RecentLeadStatus, { label: string; className: string }> = {
  NEW: { label: 'Yangi', className: 'NEW' },
  AI_PROCESSING: { label: 'AI ishlamoqda', className: 'AI_PROCESSING' },
  QUALIFIED: { label: 'Sifatli', className: 'QUALIFIED' },
  UNQUALIFIED: { label: 'Sifatsiz', className: 'UNQUALIFIED' },
  WAITING_MANAGER: { label: 'Menejer kutmoqda', className: 'WAITING_MANAGER' },
  CONTACTED: { label: 'Bog‘lanildi', className: 'CONTACTED' },
  CONVERTED: { label: 'Muvaffaqiyatli', className: 'CONVERTED' },
};

function formatDate(isoStr: string) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

export function RecentLeadsTable({ leads = [], loading }: RecentLeadsTableProps) {
  return (
    <div className={`panel-card ${loading ? 'loading-skeleton' : ''}`}>
      <div className="panel-head">
        <div>
          <h3>So‘nggi leadlar harakati</h3>
          <p>Yangi kelib tushgan murojaatlar va ularning joriy holati</p>
        </div>
      </div>

      <div className="table-container">
        <table className="custom-table">
          <thead>
            <tr>
              <th>Mijoz</th>
              <th>Telefon (Maskalangan)</th>
              <th>So‘ralgan mahsulot</th>
              <th>Kanal / Manba</th>
              <th>Status</th>
              <th>Biriktirilgan menejer</th>
              <th>Sana va vaqt</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                  So‘nggi leadlar hali mavjud emas
                </td>
              </tr>
            ) : (
              leads.map((lead) => {
                const conf = STATUS_CONFIG[lead.status] || { label: lead.status, className: 'NEW' };
                return (
                  <tr key={lead.id}>
                    <td>
                      <strong style={{ color: 'var(--text-main)' }}>{lead.customerDisplayName}</strong>
                    </td>
                    <td>
                      <code style={{ fontSize: '11.5px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        {lead.sanitizedPhone}
                      </code>
                    </td>
                    <td>{lead.requestedProduct}</td>
                    <td>
                      <span style={{ textTransform: 'capitalize', fontWeight: 600, color: '#3b82f6' }}>
                        {lead.channel === 'whatsapp' ? '💬 WhatsApp' : '✈️ Telegram'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${conf.className}`}>{conf.label}</span>
                    </td>
                    <td>{lead.manager}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{formatDate(lead.createdAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
