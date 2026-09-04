'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getConversationThreadAction, getConversationsAction } from '../../app/actions/business-actions';

export interface ConversationItem {
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

export interface MessageItem {
  id: string;
  conversationId: string;
  senderType: 'customer' | 'ai' | 'manager' | string;
  content: string;
  contentType?: string;
  status?: string;
  createdAt: string | Date;
}

interface Props {
  initialConversations: ConversationItem[];
}

export function ConversationsClientContainer({ initialConversations }: Props) {
  const [conversations, setConversations] = useState<ConversationItem[]>(initialConversations);
  const [selectedConv, setSelectedConv] = useState<ConversationItem | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, MessageItem[]>>({});
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AI_ACTIVE' | 'WAITING_MANAGER' | 'CLOSED'>('ALL');

  // Load thread messages when selected conversation changes
  useEffect(() => {
    if (!selectedConv) return;

    // If already loaded in memory, don't refetch unless empty
    if (messagesMap[selectedConv.id] && messagesMap[selectedConv.id].length > 0) {
      return;
    }

    let isMounted = true;
    setIsLoadingThread(true);
    setThreadError(null);

    getConversationThreadAction(selectedConv.id)
      .then((res) => {
        if (!isMounted) return;
        if (res.success && res.data) {
          const msgs: MessageItem[] = res.data.messages || [];
          setMessagesMap((prev) => ({ ...prev, [selectedConv.id]: msgs }));
          // Update customer details if returned richer
          if (res.data.customerName || res.data.customerPhone || res.data.customerUsername) {
            setSelectedConv((curr) => (curr ? {
              ...curr,
              customerName: res.data.customerName || curr.customerName,
              customerPhone: res.data.customerPhone || curr.customerPhone,
              customerUsername: res.data.customerUsername || curr.customerUsername,
            } : null));
          }
        } else {
          setThreadError(res.error || 'Xabarlar tarixini yuklab bo‘lmadi.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setThreadError(err?.message || 'Tarmoq xatosi.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingThread(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedConv?.id]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedConv(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Refresh conversations list
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await getConversationsAction();
      if (res.success && res.data) {
        setConversations(res.data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Filtered list
  const filteredConversations = useMemo(() => {
    return conversations.filter((item) => {
      // Status filter
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }
      // Search filter
      if (search.trim()) {
        const query = search.toLowerCase();
        const nameMatch = (item.customerName || '').toLowerCase().includes(query);
        const phoneMatch = (item.customerPhone || '').toLowerCase().includes(query);
        const userMatch = (item.customerUsername || '').toLowerCase().includes(query);
        const lastMsgMatch = (item.lastMessage?.content || '').toLowerCase().includes(query);
        const idMatch = item.id.toLowerCase().includes(query) || item.customerId.toLowerCase().includes(query);
        return nameMatch || phoneMatch || userMatch || lastMsgMatch || idMatch;
      }
      return true;
    });
  }, [conversations, statusFilter, search]);

  const activeCount = conversations.filter((c) => c.status === 'AI_ACTIVE').length;
  const waitingCount = conversations.filter((c) => c.status === 'WAITING_MANAGER').length;

  const formatDate = (dateStr?: string | Date) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('uz-UZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(dateStr);
    }
  };

  const formatMessageTime = (dateStr?: string | Date) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'AI_ACTIVE') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 700,
            color: '#065f46',
            background: '#d1fae5',
            padding: '4px 10px',
            borderRadius: '999px',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
          AI faol
        </span>
      );
    }
    if (status === 'WAITING_MANAGER') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            fontWeight: 700,
            color: '#92400e',
            background: '#fef3c7',
            padding: '4px 10px',
            borderRadius: '999px',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
          Menejer kutmoqda
        </span>
      );
    }
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          fontWeight: 700,
          color: '#475569',
          background: '#f1f5f9',
          padding: '4px 10px',
          borderRadius: '999px',
        }}
      >
        {status}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Control Header & Filters */}
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
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 280px', maxWidth: '400px' }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: '12px',
                color: '#94a3b8',
                fontSize: '14px',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              placeholder="Mijoz ismi, telefon yoki xabar matni..."
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

        {/* Status filter pills & Refresh button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
              onClick={() => setStatusFilter('ALL')}
              style={{
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: statusFilter === 'ALL' ? '#ffffff' : 'transparent',
                color: statusFilter === 'ALL' ? '#0f172a' : '#64748b',
                boxShadow: statusFilter === 'ALL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Barchasi ({conversations.length})
            </button>
            <button
              onClick={() => setStatusFilter('AI_ACTIVE')}
              style={{
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: statusFilter === 'AI_ACTIVE' ? '#ffffff' : 'transparent',
                color: statusFilter === 'AI_ACTIVE' ? '#065f46' : '#64748b',
                boxShadow: statusFilter === 'AI_ACTIVE' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              🤖 AI faol ({activeCount})
            </button>
            <button
              onClick={() => setStatusFilter('WAITING_MANAGER')}
              style={{
                border: 'none',
                padding: '6px 12px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                background: statusFilter === 'WAITING_MANAGER' ? '#ffffff' : 'transparent',
                color: statusFilter === 'WAITING_MANAGER' ? '#92400e' : '#64748b',
                boxShadow: statusFilter === 'WAITING_MANAGER' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              ⏳ Menejer kutilmoqda ({waitingCount})
            </button>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Suhbatlarni yangilash"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              padding: '7px 14px',
              borderRadius: '10px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#334155',
              cursor: isRefreshing ? 'wait' : 'pointer',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: isRefreshing ? 'rotate(360deg)' : 'none',
                transition: 'transform 0.5s ease',
              }}
            >
              🔄
            </span>
            {isRefreshing ? 'Yangilanmoqda...' : 'Yangilash'}
          </button>
        </div>
      </div>

      {/* Conversations Table */}
      {filteredConversations.length > 0 ? (
        <div
          className="table-wrap"
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '14px 18px', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                  Mijoz
                </th>
                <th style={{ padding: '14px 18px', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                  Kanal
                </th>
                <th style={{ padding: '14px 18px', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                  Status
                </th>
                <th style={{ padding: '14px 18px', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>
                  Oxirgi xabar
                </th>
                <th style={{ padding: '14px 18px', fontSize: '11px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'right' }}>
                  Amal
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredConversations.map((item) => {
                const displayName = item.customerName && item.customerName !== 'Telegram Foydalanuvchisi'
                  ? item.customerName
                  : (item.customerUsername ? `@${item.customerUsername}` : 'Telegram Foydalanuvchisi');

                const initial = displayName.replace('@', '').charAt(0).toUpperCase() || 'M';

                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedConv(item)}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Customer Info */}
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '50%',
                            background: '#ecfdf5',
                            border: '1px solid #a7f3d0',
                            color: '#059669',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {initial}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                              {displayName}
                            </span>
                            {item.customerUsername && (
                              <span style={{ fontSize: '11px', color: '#0284c7', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>
                                @{item.customerUsername}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#64748b' }}>
                            {item.customerPhone && (
                              <span>📞 {item.customerPhone}</span>
                            )}
                            {item.lastMessage ? (
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: '340px',
                                  color: '#475569',
                                  fontStyle: 'italic',
                                }}
                              >
                                {item.lastMessage.senderType === 'ai' ? '🤖 AI: ' : '👤 '}
                                {item.lastMessage.content}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '11px' }}>ID: {item.customerId.slice(0, 8)}...</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Channel */}
                    <td style={{ padding: '14px 18px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#0284c7',
                          background: '#f0f9ff',
                          border: '1px solid #bae6fd',
                          padding: '3px 8px',
                          borderRadius: '6px',
                        }}
                      >
                        ✈️ {item.channel || 'Telegram'}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={{ padding: '14px 18px' }}>
                      {getStatusBadge(item.status)}
                    </td>

                    {/* Last Message Time */}
                    <td style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500 }}>
                          {formatDate(item.lastMessageAt || item.createdAt)}
                        </span>
                        {item.messagesCount !== undefined && item.messagesCount > 0 && (
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                            💬 {item.messagesCount} ta xabar
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action button */}
                    <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedConv(item);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          background: '#059669',
                          color: '#ffffff',
                          border: 'none',
                          padding: '7px 14px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          boxShadow: '0 1px 3px rgba(5,150,105,0.2)',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#047857')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#059669')}
                      >
                        <span>💬</span> Suhbatni ochish
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>💬</div>
          <strong style={{ display: 'block', fontSize: '15px', color: '#0f172a', marginBottom: '4px' }}>
            {search ? 'Qidiruv bo‘yicha suhbat topilmadi' : 'Hozircha suhbatlar mavjud emas'}
          </strong>
          <p style={{ fontSize: '13px', margin: 0 }}>
            {search
              ? 'Boshqa so‘z bilan qidirib ko‘ring yoki filtrlarni tozalang.'
              : 'Telegram orqali mijozlar xabar yozganda suhbatlar shu yerda paydo bo‘ladi.'}
          </p>
        </div>
      )}

      {/* Interactive Chat History Modal / Drawer */}
      {selectedConv && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={() => setSelectedConv(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '560px',
              height: '100%',
              background: '#ffffff',
              boxShadow: '-4px 0 25px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    color: '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    fontWeight: 700,
                  }}
                >
                  {(selectedConv.customerName || selectedConv.customerUsername || 'M').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                      {selectedConv.customerName || (selectedConv.customerUsername ? `@${selectedConv.customerUsername}` : 'Telegram Foydalanuvchisi')}
                    </h3>
                    {selectedConv.customerUsername && (
                      <span style={{ fontSize: '11px', color: '#0284c7', background: '#e0f2fe', padding: '1px 6px', borderRadius: '4px' }}>
                        @{selectedConv.customerUsername}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    {selectedConv.customerPhone && <span>📞 {selectedConv.customerPhone}</span>}
                    <span>✈️ Telegram</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {getStatusBadge(selectedConv.status)}
                <button
                  onClick={() => setSelectedConv(null)}
                  style={{
                    background: '#e2e8f0',
                    border: 'none',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#475569',
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                  title="Yopish (Esc)"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Sub-info bar */}
            <div
              style={{
                padding: '8px 20px',
                background: '#f1f5f9',
                borderBottom: '1px solid #e2e8f0',
                fontSize: '11px',
                color: '#64748b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>ID: <code>{selectedConv.id}</code></span>
              <span>
                {messagesMap[selectedConv.id]?.length
                  ? `${messagesMap[selectedConv.id].length} ta xabar`
                  : 'Xabarlar tarixi'}
              </span>
            </div>

            {/* Chat Body */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px',
                background: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {isLoadingThread ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#64748b' }}>
                  <div style={{ fontSize: '28px' }}>⏳</div>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Xabarlar tarixi yuklanmoqda...</span>
                </div>
              ) : threadError ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '16px', color: '#991b1b', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 10px 0', fontSize: '13px' }}>{threadError}</p>
                  <button
                    onClick={() => {
                      setIsLoadingThread(true);
                      setThreadError(null);
                      getConversationThreadAction(selectedConv.id).then((res) => {
                        if (res.success && res.data) {
                          const msgs = res.data.messages || [];
                          setMessagesMap((prev) => ({ ...prev, [selectedConv.id]: msgs }));
                        } else {
                          setThreadError(res.error || 'Yuklab bo‘lmadi.');
                        }
                      }).finally(() => setIsLoadingThread(false));
                    }}
                    style={{
                      background: '#ef4444',
                      color: '#ffffff',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Qayta urinish
                  </button>
                </div>
              ) : (messagesMap[selectedConv.id]?.length || 0) === 0 ? (
                <div style={{ textAlign: 'center', margin: 'auto', color: '#94a3b8' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                  <p style={{ fontSize: '13px', margin: 0 }}>Ushbu suhbatda hali xabarlar yozilmagan.</p>
                </div>
              ) : (
                messagesMap[selectedConv.id]?.map((msg, index) => {
                  const isUser = msg.senderType === 'customer';
                  const isAI = msg.senderType === 'ai';

                  return (
                    <div
                      key={msg.id || index}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isUser ? 'flex-start' : 'flex-end',
                        maxWidth: '100%',
                      }}
                    >
                      {/* Sender label */}
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: isUser ? '#64748b' : isAI ? '#059669' : '#2563eb',
                          marginBottom: '4px',
                          marginLeft: isUser ? '8px' : '0',
                          marginRight: !isUser ? '8px' : '0',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {isUser ? (
                          <>👤 Mijoz</>
                        ) : isAI ? (
                          <>🤖 Limax AI Menejer</>
                        ) : (
                          <>👨‍💼 Menejer</>
                        )}
                      </span>

                      {/* Message bubble */}
                      <div
                        style={{
                          maxWidth: '85%',
                          padding: '12px 16px',
                          borderRadius: isUser ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
                          background: isUser ? '#ffffff' : isAI ? '#ecfdf5' : '#eff6ff',
                          color: isUser ? '#0f172a' : isAI ? '#064e3b' : '#1e3a8a',
                          border: isUser
                            ? '1px solid #e2e8f0'
                            : isAI
                            ? '1px solid #a7f3d0'
                            : '1px solid #bfdbfe',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                          fontSize: '13px',
                          lineHeight: '1.5',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {msg.content}

                        {/* Message meta/timestamp */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-end',
                            gap: '4px',
                            marginTop: '6px',
                            fontSize: '10px',
                            color: isUser ? '#94a3b8' : isAI ? '#059669' : '#3b82f6',
                          }}
                        >
                          <span>{formatMessageTime(msg.createdAt)}</span>
                          {!isUser && <span>✓✓</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid #e2e8f0',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#64748b',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span>Telegram orqali doimiy sinxronlashgan</span>
              </div>
              <button
                onClick={() => setSelectedConv(null)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
