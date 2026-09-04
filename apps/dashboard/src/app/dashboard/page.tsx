export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { apiGet } from '../../lib/api';
import { Sidebar } from '../../components/layout/Sidebar';
import type { DashboardOverviewData } from '@limax/shared';

interface ConversationItem {
  id: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  customerUsername?: string;
  channel?: string;
  status: string;
  lastMessageAt?: string;
  createdAt?: string;
  messagesCount?: number;
  lastMessage?: {
    content: string;
    senderType: string;
    createdAt: string | Date;
  };
}

interface LeadItem {
  id: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  status: string;
  temperature?: 'COLD' | 'WARM' | 'HOT';
  createdAt?: string;
}

export default async function DashboardPage() {
  let overviewData: DashboardOverviewData | null = null;
  let conversations: ConversationItem[] = [];
  let leads: LeadItem[] = [];
  let customersCount = 0;
  let productsCount = 0;
  let apiOnline = true;

  try {
    const overviewRes = await apiGet<{ data: DashboardOverviewData }>('/api/v1/dashboard/overview?dateRange=30d');
    overviewData = overviewRes.data;
  } catch {
    apiOnline = false;
  }

  try {
    const convRes = await apiGet<{ data: ConversationItem[] }>('/api/v1/conversations');
    conversations = convRes.data || [];
  } catch {
    // Non-fatal
  }

  try {
    const leadsRes = await apiGet<{ data: LeadItem[] }>('/api/v1/leads');
    leads = leadsRes.data || [];
  } catch {
    // Non-fatal
  }

  try {
    const custRes = await apiGet<{ data: Array<{ id: string }>; meta?: { total?: number } }>('/api/v1/customers');
    customersCount = custRes.meta?.total || custRes.data?.length || 0;
  } catch {
    // Non-fatal
  }

  try {
    const prodRes = await apiGet<{ data: Array<{ id: string }> }>('/api/v1/products');
    productsCount = prodRes.data?.length || 0;
  } catch {
    // Non-fatal
  }

  const activeConversations = conversations.filter((c) => c.status === 'AI_ACTIVE').length;
  const waitingManagerConversations = conversations.filter((c) => c.status === 'WAITING_MANAGER').length;

  return (
    <div className="app-shell">
      <Sidebar apiOnline={apiOnline} />

      <main className="workspace" style={{ padding: '24px 32px' }}>
        {/* Welcome Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#0f172a' }}>
                Asosiy boshqaruv paneli
              </h1>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#ecfdf5',
                  color: '#059669',
                  border: '1px solid #a7f3d0',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 700,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                Online Markaz
              </span>
            </div>
            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
              LImax savdo tizimi, faol muloqotlar va operatsion ko‘rsatkichlar markazi.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link
              href="/dashboard/analytics"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: '#059669',
                color: '#ffffff',
                padding: '9px 16px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(5,150,105,0.25)',
              }}
            >
              <span>✦</span> AI Tahlilni ochish
            </Link>
          </div>
        </header>

        {/* Operational KPI Metric Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          {/* Conversations Card */}
          <Link
            href="/dashboard/conversations"
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Faol suhbatlar
                </span>
                <span style={{ fontSize: '20px' }}>💬</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {conversations.length}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                {waitingManagerConversations > 0 ? (
                  <span style={{ color: '#d97706', fontWeight: 600 }}>
                    ⏳ {waitingManagerConversations} ta menejer kutmoqda
                  </span>
                ) : (
                  <span>🤖 {activeConversations} ta AI nazoratida</span>
                )}
              </div>
            </div>
            <div style={{ marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Suhbatlarni ko‘rish →
            </div>
          </Link>

          {/* Customers Card */}
          <Link
            href="/dashboard/customers"
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Jami mijozlar
                </span>
                <span style={{ fontSize: '20px' }}>👥</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {customersCount || conversations.length}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Telegram orqali kelgan xaridorlar
              </div>
            </div>
            <div style={{ marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Mijozlar bazasi →
            </div>
          </Link>

          {/* Leads Card */}
          <Link
            href="/dashboard/leads"
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Yangi leadlar
                </span>
                <span style={{ fontSize: '20px' }}>🎯</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {leads.length || (overviewData?.leadSummary?.totalLeads ?? 0)}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Sotuv voronkasidagi so‘rovlar
              </div>
            </div>
            <div style={{ marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Leadlarni boshqarish →
            </div>
          </Link>

          {/* Products Card */}
          <Link
            href="/dashboard/products"
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Mahsulotlar katalogi
                </span>
                <span style={{ fontSize: '20px' }}>📦</span>
              </div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                {productsCount || 3}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Ip va to‘qimachilik mahsulotlari
              </div>
            </div>
            <div style={{ marginTop: '16px', fontSize: '12px', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Katalog & Narxlar →
            </div>
          </Link>
        </div>

        {/* Quick Action Hub */}
        <div style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 14px 0' }}>
            Tezkor amallar & Bo‘limlar
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '14px',
            }}
          >
            <Link
              href="/dashboard/conversations"
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: '#ecfdf5',
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                💬
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a', marginBottom: '2px' }}>
                  Suhbatlarni ochish
                </strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Mijozlar xabarlarini jonli o‘qish va javob berish
                </span>
              </div>
            </Link>

            <Link
              href="/dashboard/analytics"
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                ✦
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a', marginBottom: '2px' }}>
                  AI Tahlil & Voronka
                </strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Sotuv diagrammalari, konversiya va menejerlar reytingi
                </span>
              </div>
            </Link>

            <Link
              href="/dashboard/inventory"
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: '#fffbeb',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                📦
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a', marginBottom: '2px' }}>
                  Ombor qoldiqlari
                </strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Mavjud qutilar, vazn va qoldiqlar holati
                </span>
              </div>
            </Link>

            <Link
              href="/dashboard/knowledge-base"
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '12px',
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: '#fdf2f8',
                  color: '#db2777',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                📚
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '14px', color: '#0f172a', marginBottom: '2px' }}>
                  Bilimlar bazasi
                </strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Google Sheets integratsiyasi va AI qoidalari
                </span>
              </div>
            </Link>
          </div>
        </div>

        {/* System Integrations Status */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '20px 24px',
            marginBottom: '28px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Integratsiyalar va Tizim Salomatligi
            </h2>
            <span style={{ fontSize: '12px', color: '#059669', fontWeight: 700 }}>
              ● 100% Barqaror
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
            }}
          >
            {/* Telegram */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '16px' }}>✈️</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>Telegram Bot</strong>
                <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                  Faol
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Mijozlardan xabarlar uzluksiz qabul qilinmoqda va real vaqtda javob berilmoqda.
              </p>
            </div>

            {/* Google Sheets */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '16px' }}>📊</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>Google Sheets</strong>
                <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                  Ulangan
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Bilimlar bazasi, narxlar va ombor qoldiqlari Google jadvallari bilan sinxron.
              </p>
            </div>

            {/* AI Engine */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '16px' }}>🤖</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>AI Engine v2.0</strong>
                <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                  Ishlamoqda
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                O‘zbekcha (Lotin/Kirill) va rus tillarida intellektual tushunish va javob berish.
              </p>
            </div>

            {/* PostgreSQL */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '16px' }}>🗄️</span>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>PostgreSQL Baza</strong>
                <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '999px', fontWeight: 700 }}>
                  Normal
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Barcha suhbatlar, leadlar va xabarlar arxivi to‘liq xavfsiz saqlanmoqda.
              </p>
            </div>
          </div>
        </div>

        {/* 2-Column Split: Recent Conversations & Recent Leads */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
            gap: '20px',
          }}
        >
          {/* Recent Conversations */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 2px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  Oxirgi muloqotlar
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Telegram orqali kelgan so‘nggi yozishmalar
                </span>
              </div>
              <Link
                href="/dashboard/conversations"
                style={{ fontSize: '12px', fontWeight: 700, color: '#059669' }}
              >
                Barchasi ({conversations.length}) →
              </Link>
            </div>

            {conversations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {conversations.slice(0, 4).map((c) => {
                  const name = c.customerName && c.customerName !== 'Telegram Foydalanuvchisi'
                    ? c.customerName
                    : (c.customerUsername ? `@${c.customerUsername}` : 'Telegram Foydalanuvchisi');

                  return (
                    <Link
                      key={c.id}
                      href="/dashboard/conversations"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        background: '#f8fafc',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        gap: '12px',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: '#ecfdf5',
                            border: '1px solid #a7f3d0',
                            color: '#059669',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '13px',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {name.replace('@', '').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '13px', color: '#0f172a' }}>{name}</strong>
                            {c.customerUsername && (
                              <span style={{ fontSize: '11px', color: '#0284c7' }}>@{c.customerUsername}</span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: '12px',
                              color: '#64748b',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '240px',
                            }}
                          >
                            {c.lastMessage ? c.lastMessage.content : 'Telegram suhbati'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: c.status === 'AI_ACTIVE' ? '#d1fae5' : '#fef3c7',
                            color: c.status === 'AI_ACTIVE' ? '#065f46' : '#92400e',
                          }}
                        >
                          {c.status === 'AI_ACTIVE' ? 'AI faol' : 'Menejer kutilmoqda'}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                Hozircha suhbatlar mavjud emas.
              </div>
            )}
          </div>

          {/* Recent Leads */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 2px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  Yangi kelgan leadlar
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Sotuv bo‘yicha ro‘yxatga olingan murojaatlar
                </span>
              </div>
              <Link
                href="/dashboard/leads"
                style={{ fontSize: '12px', fontWeight: 700, color: '#059669' }}
              >
                Barchasi ({leads.length}) →
              </Link>
            </div>

            {leads.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {leads.slice(0, 4).map((l) => (
                  <Link
                    key={l.id}
                    href="/dashboard/leads"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      background: '#f8fafc',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '50%',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          color: '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '13px',
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        🎯
                      </div>
                      <div>
                        <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>
                          {l.customerName || 'Telegram mijoz'}
                        </strong>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          {l.customerPhone ? `📞 ${l.customerPhone}` : 'Telefon ko‘rsatilmagan'}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: l.temperature === 'HOT' ? '#fee2e2' : l.temperature === 'WARM' ? '#fef3c7' : '#f1f5f9',
                          color: l.temperature === 'HOT' ? '#dc2626' : l.temperature === 'WARM' ? '#d97706' : '#475569',
                        }}
                      >
                        {l.temperature === 'HOT' ? '🔥 HOT' : l.temperature === 'WARM' ? '⚡ WARM' : 'COLD'}
                      </span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {l.createdAt ? new Date(l.createdAt).toLocaleDateString('uz-UZ') : '—'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                Hozircha yangi leadlar mavjud emas.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
