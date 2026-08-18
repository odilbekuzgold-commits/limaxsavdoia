'use client';

import React, { useState, useTransition } from 'react';
import { updateInventoryAction } from '../../app/actions/business-actions';

export interface ProductItem {
  id: string;
  name: string;
  code?: string;
}

export interface InventoryItem {
  id: string;
  productId: string;
  status: string;
  availableQuantity: number;
  reservedQuantity: number;
  unit: string;
  warehouse?: string;
  version?: number;
  updatedAt?: string;
}

interface Props {
  initialProducts: ProductItem[];
  initialInventory: InventoryItem[];
}

export function InventoryClientContainer({ initialProducts, initialInventory }: Props) {
  const [inventoryList, setInventoryList] = useState<InventoryItem[]>(initialInventory);
  const [editingItem, setEditingItem] = useState<{ product: ProductItem; inv: InventoryItem | null } | null>(null);

  const [availableQty, setAvailableQty] = useState('0');
  const [reservedQty, setReservedQty] = useState('0');
  const [unit, setUnit] = useState('kg');
  const [warehouse, setWarehouse] = useState('');
  const [status, setStatus] = useState('IN_STOCK');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleOpenEdit = (product: ProductItem, inv: InventoryItem | null) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setEditingItem({ product, inv });
    setAvailableQty(inv ? String(inv.availableQuantity) : '0');
    setReservedQty(inv ? String(inv.reservedQuantity) : '0');
    setUnit(inv ? inv.unit : 'kg');
    setWarehouse(inv ? inv.warehouse || '' : '');
    setStatus(inv ? inv.status : 'IN_STOCK');
  };

  const handleUpdateInventory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setErrorMsg(null);

    const avail = parseFloat(availableQty);
    const res = parseFloat(reservedQty);

    if (isNaN(avail) || avail < 0 || isNaN(res) || res < 0) {
      setErrorMsg('Ombor qoldiqlari manfiy bo‘lishi mumkin emas.');
      return;
    }

    if (res > avail) {
      setErrorMsg('Rezerv miqdori mavjud miqdordan katta bo‘lishi mumkin emas.');
      return;
    }

    const derivedStatus = avail === 0 || (avail - res) <= 0 ? 'OUT_OF_STOCK' : status;

    startTransition(async () => {
      const resp = await updateInventoryAction(editingItem.product.id, {
        availableQuantity: avail,
        reservedQuantity: res,
        unit,
        warehouse: warehouse.trim() || undefined,
        status: derivedStatus,
        expectedVersion: editingItem.inv?.version,
      });

      if (!resp.success) {
        setErrorMsg(resp.error || 'Ombor qoldig‘ini yangilashda xatolik');
      } else {
        setSuccessMsg(`"${editingItem.product.name}" ombor qoldig‘i muvaffaqiyatli yangilandi.`);
        const updatedRecord = resp.data as InventoryItem;
        setInventoryList((prev) => {
          const idx = prev.findIndex((i) => i.productId === editingItem.product.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = updatedRecord;
            return copy;
          }
          return [...prev, updatedRecord];
        });
        setEditingItem(null);
      }
    });
  };

  const netAvailable = (avail: number, res: number) => Math.max(0, avail - res);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Google Sheets Sync Info Banner */}
      <div style={{ padding: '14px 18px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <span style={{ fontWeight: 600, color: '#166534' }}>📊 Manba: Google Sheets (Read-Only)</span>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#15803d' }}>
            Ombor qoldiqlari faqat tasdiqlangan Google Sheet orqali yangilanadi. Qoʻlda tahrirlash bloklangan.
          </p>
        </div>
        <a
          href="https://docs.google.com/spreadsheets/d/1a8ouEPIArKhHzrLlmGGlpiD1wKYqOFKHzMoY9JkllBI/edit"
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '6px 12px', background: '#16a34a', color: '#fff', textDecoration: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}
        >
          Google Sheetni Ochish ↗
        </a>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', border: '1px solid #fca5a5' }}>
          <strong>Xatolik:</strong> {errorMsg}
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '12px 16px', background: '#dcfce7', color: '#166534', borderRadius: '8px', border: '1px solid #86efac' }}>
          {successMsg}
        </div>
      )}

      {/* Inventory Table */}
      <div className="table-wrap" style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
              <th style={{ padding: '12px' }}>Mahsulot</th>
              <th style={{ padding: '12px' }}>Status</th>
              <th style={{ padding: '12px' }}>Mavjud</th>
              <th style={{ padding: '12px' }}>Rezerv</th>
              <th style={{ padding: '12px' }}>Sof Qoldiq</th>
              <th style={{ padding: '12px' }}>Ombor</th>
              <th style={{ padding: '12px' }}>Oxirgi Yangilanish</th>
              <th style={{ padding: '12px' }}>Amal</th>
            </tr>
          </thead>
          <tbody>
            {initialProducts.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  Katalogda mahsulotlar mavjud emas.
                </td>
              </tr>
            ) : (
              initialProducts.map((p) => {
                const inv = inventoryList.find((i) => i.productId === p.id);
                const avail = inv ? inv.availableQuantity : 0;
                const resQty = inv ? inv.reservedQuantity : 0;
                const net = netAvailable(avail, resQty);
                const invStatus = !inv ? 'UNKNOWN' : (avail === 0 || net <= 0 ? 'OUT_OF_STOCK' : inv.status);

                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px' }}>
                      <strong>{p.name}</strong> {p.code && <span style={{ color: '#64748b', fontSize: '12px' }}>({p.code})</span>}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor:
                            invStatus === 'IN_STOCK' ? '#dcfce7' : invStatus === 'LOW_STOCK' ? '#fef9c3' : invStatus === 'OUT_OF_STOCK' ? '#fee2e2' : '#f1f5f9',
                          color:
                            invStatus === 'IN_STOCK' ? '#166534' : invStatus === 'LOW_STOCK' ? '#854d0e' : invStatus === 'OUT_OF_STOCK' ? '#991b1b' : '#64748b',
                        }}
                      >
                        {invStatus}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>{inv ? `${avail} ${inv.unit}` : 'UNKNOWN'}</td>
                    <td style={{ padding: '12px' }}>{inv ? `${resQty} ${inv.unit}` : 'UNKNOWN'}</td>
                    <td style={{ padding: '12px', fontWeight: 600, color: net > 0 ? '#166534' : '#991b1b' }}>
                      {inv ? `${net} ${inv.unit}` : 'UNKNOWN'}
                    </td>
                    <td style={{ padding: '12px', color: '#64748b' }}>{inv?.warehouse || '—'}</td>
                    <td style={{ padding: '12px', color: '#94a3b8', fontSize: '12px' }}>
                      {inv?.updatedAt ? new Date(inv.updatedAt).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <button
                        onClick={() => handleOpenEdit(p, inv || null)}
                        style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
                      >
                        {inv ? 'Yangilash' : 'Kiritish'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Inventory Update Modal */}
      {editingItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <form onSubmit={handleUpdateInventory} style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '440px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3>Ombor Qoldig‘ini Yangilash: {editingItem.product.name}</h3>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Mavjud Miqdor (Available) *</label>
              <input type="number" step="0.01" value={availableQty} onChange={(e) => setAvailableQty(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Rezerv Miqdori (Reserved) *</label>
              <input type="number" step="0.01" value={reservedQty} onChange={(e) => setReservedQty(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>O‘lchov Birligi (Unit) *</label>
              <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Ombor Nomi (Warehouse)</label>
              <input type="text" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder="Masalan: Toshkent Bosh Ombor" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button type="button" onClick={() => setEditingItem(null)} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                Bekor qilish
              </button>
              <button type="submit" disabled={isPending} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                {isPending ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
