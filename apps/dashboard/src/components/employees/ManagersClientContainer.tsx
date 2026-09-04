'use client';

import React, { useState, useMemo } from 'react';
import {
  getManagersAction,
  createManagerAction,
  updateManagerAction,
  toggleManagerDutyAction,
  deleteManagerAction,
} from '../../app/actions/business-actions';

export interface ManagerItem {
  id: string;
  name: string;
  role: string;
  phone?: string;
  telegramUsername?: string;
  telegramChatId?: string;
  status: 'ACTIVE' | 'INACTIVE' | string;
  isOnDuty: boolean;
  specialties: string[];
  maxActiveLeads: number;
  totalLeads?: number;
  qualifiedLeads?: number;
  qualificationRate?: number;
  wonDeals?: number;
  activeHandoffs?: number;
  conversionRate?: number;
  createdAt?: string;
}

interface Props {
  initialManagers: ManagerItem[];
}

export function ManagersClientContainer({ initialManagers }: Props) {
  const [managers, setManagers] = useState<ManagerItem[]>(initialManagers);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'ON_DUTY' | 'ACTIVE'>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<ManagerItem | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('Sotuv menejeri');
  const [formPhone, setFormPhone] = useState('');
  const [formTelegram, setFormTelegram] = useState('');
  const [formSpecialties, setFormSpecialties] = useState('');
  const [formIsOnDuty, setFormIsOnDuty] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form
  const resetForm = () => {
    setFormName('');
    setFormRole('Sotuv menejeri');
    setFormPhone('');
    setFormTelegram('');
    setFormSpecialties('');
    setFormIsOnDuty(false);
    setFormError('');
  };

  // Open Edit Modal
  const handleOpenEdit = (m: ManagerItem) => {
    setEditingManager(m);
    setFormName(m.name);
    setFormRole(m.role || 'Sotuv menejeri');
    setFormPhone(m.phone || '');
    setFormTelegram(m.telegramUsername ? `@${m.telegramUsername}` : '');
    setFormSpecialties(m.specialties?.join(', ') || '');
    setFormIsOnDuty(Boolean(m.isOnDuty));
    setFormError('');
  };

  // Refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await getManagersAction();
      if (res.success && res.data) {
        setManagers(res.data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Toggle Duty
  const handleToggleDuty = async (m: ManagerItem) => {
    const nextDuty = !m.isOnDuty;
    // Optimistic update
    setManagers((prev) =>
      prev.map((item) => (item.id === m.id ? { ...item, isOnDuty: nextDuty } : item))
    );

    const res = await toggleManagerDutyAction(m.id, nextDuty);
    if (!res.success) {
      // Revert on failure
      setManagers((prev) =>
        prev.map((item) => (item.id === m.id ? { ...item, isOnDuty: m.isOnDuty } : item))
      );
      alert(res.error || 'Navbatchilik holatini o‘zgartirib bo‘lmadi.');
    }
  };

  // Save Create
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Menejer ism-sharifini kiriting.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    const specialtiesList = formSpecialties
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const cleanTelegram = formTelegram.trim().replace(/^@/, '');

    const res = await createManagerAction({
      name: formName.trim(),
      role: formRole.trim(),
      phone: formPhone.trim() || undefined,
      telegramUsername: cleanTelegram || undefined,
      specialties: specialtiesList,
      isOnDuty: formIsOnDuty,
    });

    setIsSubmitting(false);

    if (res.success && res.data) {
      setManagers((prev) => [res.data, ...prev]);
      setIsAddOpen(false);
      resetForm();
    } else {
      setFormError(res.error || 'Menejer qo‘shishda xatolik yuz berdi.');
    }
  };

  // Save Edit
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingManager) return;
    if (!formName.trim()) {
      setFormError('Menejer ism-sharifini kiriting.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    const specialtiesList = formSpecialties
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const cleanTelegram = formTelegram.trim().replace(/^@/, '');

    const res = await updateManagerAction(editingManager.id, {
      name: formName.trim(),
      role: formRole.trim(),
      phone: formPhone.trim() || undefined,
      telegramUsername: cleanTelegram || undefined,
      specialties: specialtiesList,
      isOnDuty: formIsOnDuty,
    });

    setIsSubmitting(false);

    if (res.success && res.data) {
      setManagers((prev) =>
        prev.map((item) => (item.id === editingManager.id ? { ...item, ...res.data } : item))
      );
      setEditingManager(null);
      resetForm();
    } else {
      setFormError(res.error || 'Menejer ma‘lumotlarini saqlab bo‘lmadi.');
    }
  };

  // Delete
  const handleDelete = async (m: ManagerItem) => {
    if (!confirm(`"${m.name}" menejerini ro‘yxatdan o‘chirmoqchimisiz?`)) return;

    // Optimistic delete
    setManagers((prev) => prev.filter((item) => item.id !== m.id));

    const res = await deleteManagerAction(m.id);
    if (!res.success) {
      alert(res.error || 'Menejerni o‘chirib bo‘lmadi.');
      handleRefresh();
    }
  };

  // Filtered managers
  const filteredManagers = useMemo(() => {
    return managers.filter((item) => {
      if (filterMode === 'ON_DUTY' && !item.isOnDuty) return false;
      if (filterMode === 'ACTIVE' && item.status !== 'ACTIVE') return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const nameMatch = item.name.toLowerCase().includes(q);
        const roleMatch = (item.role || '').toLowerCase().includes(q);
        const phoneMatch = (item.phone || '').toLowerCase().includes(q);
        const tgMatch = (item.telegramUsername || '').toLowerCase().includes(q);
        return nameMatch || roleMatch || phoneMatch || tgMatch;
      }
      return true;
    });
  }, [managers, filterMode, search]);

  // Overall stats
  const totalManagers = managers.length;
  const onDutyCount = managers.filter((m) => m.isOnDuty).length;
  const totalAssignedLeads = managers.reduce((acc, m) => acc + (m.totalLeads || 0), 0);
  const totalWonDeals = managers.reduce((acc, m) => acc + (m.wonDeals || 0), 0);
  const avgConversion = totalAssignedLeads > 0 ? Math.round((totalWonDeals / totalAssignedLeads) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 4 Summary KPI Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Total Managers */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Jami Sotuv Menejerlari
            </span>
            <span style={{ fontSize: '20px' }}>👥</span>
          </div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
            {totalManagers} nafar
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Faol savdo guruhi a‘zolari
          </div>
        </div>

        {/* On-Duty Managers */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Navbatchi Menejerlar
            </span>
            <span style={{ fontSize: '20px' }}>🟢</span>
          </div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: '#059669', marginBottom: '4px' }}>
            {onDutyCount} nafar
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Hozir Telegram so‘rovlarini qabul qilmoqda
          </div>
        </div>

        {/* Total Assigned Leads */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              Biriktirilgan Leadlar
            </span>
            <span style={{ fontSize: '20px' }}>🎯</span>
          </div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
            {totalAssignedLeads} ta
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Menejerlar nazoratidagi mijozlar
          </div>
        </div>

        {/* Average Conversion */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
              O‘rtacha Konversiya
            </span>
            <span style={{ fontSize: '20px' }}>📈</span>
          </div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: '#2563eb', marginBottom: '4px' }}>
            {avgConversion}%
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Muvaffaqiyatli yakunlangan bitimlar
          </div>
        </div>
      </div>

      {/* Control Bar: Search, Filters & Action Buttons */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: '#ffffff',
          padding: '16px 20px',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
        }}
      >
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 260px', maxWidth: '380px' }}>
          <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: '12px', color: '#94a3b8', fontSize: '14px', pointerEvents: 'none' }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Ism, lavozim, telefon yoki @username..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px 9px 36px',
                fontSize: '13px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                outline: 'none',
                background: '#f8fafc',
                color: '#1e293b',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              background: '#f1f5f9',
              padding: '3px',
              borderRadius: '10px',
              gap: '2px',
            }}
          >
            <button
              onClick={() => setFilterMode('ALL')}
              style={{
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: filterMode === 'ALL' ? '#ffffff' : 'transparent',
                color: filterMode === 'ALL' ? '#0f172a' : '#64748b',
                boxShadow: filterMode === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Barchasi ({totalManagers})
            </button>
            <button
              onClick={() => setFilterMode('ON_DUTY')}
              style={{
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: filterMode === 'ON_DUTY' ? '#ffffff' : 'transparent',
                color: filterMode === 'ON_DUTY' ? '#065f46' : '#64748b',
                boxShadow: filterMode === 'ON_DUTY' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              🟢 Navbatchilar ({onDutyCount})
            </button>
            <button
              onClick={() => setFilterMode('ACTIVE')}
              style={{
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: filterMode === 'ACTIVE' ? '#ffffff' : 'transparent',
                color: filterMode === 'ACTIVE' ? '#2563eb' : '#64748b',
                boxShadow: filterMode === 'ACTIVE' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Faollar ({managers.filter((m) => m.status === 'ACTIVE').length})
            </button>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              padding: '7px 12px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#334155',
              cursor: isRefreshing ? 'wait' : 'pointer',
            }}
          >
            <span>🔄</span>
            {isRefreshing ? 'Yangilanmoqda...' : 'Yangilash'}
          </button>

          <button
            onClick={() => {
              resetForm();
              setIsAddOpen(true);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#059669',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(5,150,105,0.25)',
            }}
          >
            <span>+</span> Yangi menejer qo‘shish
          </button>
        </div>
      </div>

      {/* Managers Grid Cards */}
      {filteredManagers.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: '18px',
          }}
        >
          {filteredManagers.map((m) => {
            const initials = m.name
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();

            const conversion = m.conversionRate ?? (m.totalLeads ? Math.round(((m.wonDeals || 0) / m.totalLeads) * 100) : 0);

            return (
              <div
                key={m.id}
                style={{
                  background: '#ffffff',
                  border: m.isOnDuty ? '2px solid #10b981' : '1px solid var(--border)',
                  borderRadius: '16px',
                  padding: '20px',
                  boxShadow: m.isOnDuty ? '0 4px 14px rgba(16,185,129,0.1)' : '0 2px 8px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Card Top: Avatar, Name, Duty Toggle */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '46px',
                          height: '46px',
                          borderRadius: '50%',
                          background: m.isOnDuty ? '#d1fae5' : '#eff6ff',
                          border: m.isOnDuty ? '2px solid #10b981' : '1px solid #bfdbfe',
                          color: m.isOnDuty ? '#059669' : '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '16px',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {initials}
                      </div>
                      <div>
                        <h3 style={{ margin: '0 0 3px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                          {m.name}
                        </h3>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#475569',
                            background: '#f1f5f9',
                            padding: '2px 8px',
                            borderRadius: '6px',
                          }}
                        >
                          {m.role || 'Sotuv menejeri'}
                        </span>
                      </div>
                    </div>

                    {/* Duty Toggle Button */}
                    <button
                      onClick={() => handleToggleDuty(m)}
                      title="Navbatchilikni yoqish / o‘chirish"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '5px 10px',
                        borderRadius: '999px',
                        border: m.isOnDuty ? '1px solid #a7f3d0' : '1px solid #cbd5e1',
                        background: m.isOnDuty ? '#ecfdf5' : '#f8fafc',
                        color: m.isOnDuty ? '#065f46' : '#64748b',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: m.isOnDuty ? '#10b981' : '#94a3b8',
                        }}
                      />
                      {m.isOnDuty ? 'Navbatchilikda' : 'Oddiy rejim'}
                    </button>
                  </div>

                  {/* Contacts */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', fontSize: '12px' }}>
                    {m.phone ? (
                      <a
                        href={`tel:${m.phone}`}
                        style={{ color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                      >
                        <span>📞</span> {m.phone}
                      </a>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>📞 Telefon ko‘rsatilmagan</span>
                    )}

                    {m.telegramUsername ? (
                      <a
                        href={`https://t.me/${m.telegramUsername.replace('@', '')}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                      >
                        <span>✈️</span> @{m.telegramUsername.replace('@', '')}
                      </a>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>✈️ Telegram kiritilmagan</span>
                    )}
                  </div>

                  {/* Specialties Pills */}
                  {m.specialties && m.specialties.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '14px' }}>
                      {m.specialties.map((s, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#0f766e',
                            background: '#f0fdfa',
                            border: '1px solid #ccfbf1',
                            padding: '2px 7px',
                            borderRadius: '4px',
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Performance / KPI Box */}
                  <div
                    style={{
                      background: '#f8fafc',
                      borderRadius: '12px',
                      padding: '12px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', textAlign: 'center', marginBottom: '10px' }}>
                      <div>
                        <small style={{ display: 'block', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                          Jami Leadlar
                        </small>
                        <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                          {m.totalLeads || 0}
                        </strong>
                      </div>
                      <div>
                        <small style={{ display: 'block', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                          Sifatli
                        </small>
                        <strong style={{ fontSize: '15px', color: '#059669' }}>
                          {m.qualifiedLeads || 0}
                        </strong>
                      </div>
                      <div>
                        <small style={{ display: 'block', color: '#64748b', fontSize: '10px', textTransform: 'uppercase', marginBottom: '2px' }}>
                          Konversiya
                        </small>
                        <strong style={{ fontSize: '15px', color: '#2563eb' }}>
                          {conversion}%
                        </strong>
                      </div>
                    </div>

                    {/* Visual Conversion Progress */}
                    <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, Math.max(0, conversion))}%`,
                          height: '100%',
                          background: conversion >= 50 ? '#10b981' : '#3b82f6',
                          borderRadius: '3px',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Bottom: Edit / Delete buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                  <button
                    onClick={() => handleOpenEdit(m)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ✏️ Tahrirlash
                  </button>
                  <button
                    onClick={() => handleDelete(m)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: '#fff1f2',
                      border: '1px solid #fecdd3',
                      color: '#e11d48',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    🗑️ O‘chirish
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '50px 20px',
            textAlign: 'center',
            color: '#64748b',
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>👥</div>
          <strong style={{ display: 'block', fontSize: '15px', color: '#0f172a', marginBottom: '4px' }}>
            {search ? 'Qidiruv bo‘yicha menejer topilmadi' : 'Hozircha menejerlar ro‘yxati bo‘sh'}
          </strong>
          <p style={{ fontSize: '13px', margin: '0 0 16px 0' }}>
            {search
              ? 'Boshqa so‘z bilan qidirib ko‘ring yoki filtrlarni tozalang.'
              : 'Yangi sotuv menejerini ro‘yxatdan o‘tkazish uchun tugmani bosing.'}
          </p>
          {!search && (
            <button
              onClick={() => {
                resetForm();
                setIsAddOpen(true);
              }}
              style={{
                background: '#059669',
                color: '#ffffff',
                border: 'none',
                padding: '9px 18px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Yangi menejer qo‘shish
            </button>
          )}
        </div>
      )}

      {/* Add Manager Modal */}
      {isAddOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setIsAddOpen(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                Yangi sotuv menejeri qo‘shish
              </h3>
              <button
                onClick={() => setIsAddOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {formError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                  {formError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Ism-familiya *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Masalan: Azizbek Karimov"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Lavozimi
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                    background: '#ffffff',
                  }}
                >
                  <option value="Bosh sotuv menejeri">Bosh sotuv menejeri (Head of Sales)</option>
                  <option value="Katta sotuv menejeri">Katta sotuv menejeri (Senior Sales)</option>
                  <option value="Eksport va VIP buyurtmalar menejeri">Eksport va VIP buyurtmalar menejeri</option>
                  <option value="Ichki bozor va chakana savdo menejeri">Ichki bozor va chakana savdo menejeri</option>
                  <option value="Sotuv menejeri">Sotuv menejeri (Sales Representative)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Telefon raqam
                  </label>
                  <input
                    type="text"
                    placeholder="+998 90 123 45 67"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Telegram username
                  </label>
                  <input
                    type="text"
                    placeholder="@username"
                    value={formTelegram}
                    onChange={(e) => setFormTelegram(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Ixtisosligi / Mahsulotlar (vergul bilan)
                </label>
                <input
                  type="text"
                  placeholder="Ip 30/70, Eksport, Bo‘yalgan ip"
                  value={formSpecialties}
                  onChange={(e) => setFormSpecialties(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="isOnDutyCheck"
                  checked={formIsOnDuty}
                  onChange={(e) => setFormIsOnDuty(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981', cursor: 'pointer' }}
                />
                <label htmlFor="isOnDutyCheck" style={{ fontSize: '13px', color: '#1e293b', cursor: 'pointer', fontWeight: 600 }}>
                  Hozir navbatchilikka qo‘yilsin (Telegram suhbatlarini qabul qilish)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#059669',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isSubmitting ? 'wait' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Saqlanmoqda...' : 'Menejerni qo‘shish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Manager Modal */}
      {editingManager && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setEditingManager(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                Menejer ma‘lumotlarini tahrirlash
              </h3>
              <button
                onClick={() => setEditingManager(null)}
                style={{ background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {formError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', fontSize: '13px' }}>
                  {formError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Ism-familiya *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Lavozimi
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                    background: '#ffffff',
                  }}
                >
                  <option value="Bosh sotuv menejeri">Bosh sotuv menejeri (Head of Sales)</option>
                  <option value="Katta sotuv menejeri">Katta sotuv menejeri (Senior Sales)</option>
                  <option value="Eksport va VIP buyurtmalar menejeri">Eksport va VIP buyurtmalar menejeri</option>
                  <option value="Ichki bozor va chakana savdo menejeri">Ichki bozor va chakana savdo menejeri</option>
                  <option value="Sotuv menejeri">Sotuv menejeri (Sales Representative)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Telefon raqam
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                    Telegram username
                  </label>
                  <input
                    type="text"
                    value={formTelegram}
                    onChange={(e) => setFormTelegram(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Ixtisosligi / Mahsulotlar (vergul bilan)
                </label>
                <input
                  type="text"
                  value={formSpecialties}
                  onChange={(e) => setFormSpecialties(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="editIsOnDutyCheck"
                  checked={formIsOnDuty}
                  onChange={(e) => setFormIsOnDuty(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#10b981', cursor: 'pointer' }}
                />
                <label htmlFor="editIsOnDutyCheck" style={{ fontSize: '13px', color: '#1e293b', cursor: 'pointer', fontWeight: 600 }}>
                  Navbatchilikda (Hozir yangi suhbatlarni qabul qiladi)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditingManager(null)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: '#059669',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isSubmitting ? 'wait' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Saqlanmoqda...' : 'O‘zgarishlarni saqlash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
