'use client';

import React, { useState, useTransition } from 'react';
import {
  createProductAction,
  updateProductAction,
  toggleProductActiveAction,
  createPriceAction,
  deactivatePriceAction,
} from '../../app/actions/business-actions';

export interface ProductItem {
  id: string;
  name: string;
  code?: string;
  category?: string;
  description?: string;
  price?: number;
  currency?: string;
  minimumOrder?: number;
  stockStatus?: string;
  active: boolean;
  aiRecommendable?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PriceRecord {
  id: string;
  productId: string;
  price: number;
  currency: string;
  unit: string;
  minimumQuantity: number;
  validFrom: string;
  validUntil?: string;
  active: boolean;
  notes?: string;
  createdAt?: string;
}

interface Props {
  initialProducts: ProductItem[];
  initialPrices: Record<string, PriceRecord[]>;
}

export function ProductsClientContainer({ initialProducts, initialPrices }: Props) {
  const [products, setProducts] = useState<ProductItem[]>(initialProducts);
  const [pricesMap, setPricesMap] = useState<Record<string, PriceRecord[]>>(initialPrices);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [pricingProduct, setPricingProduct] = useState<ProductItem | null>(null);

  // Form states
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formActive, setFormActive] = useState(true);

  // Price form states
  const [priceAmount, setPriceAmount] = useState('');
  const [priceCurrency, setPriceCurrency] = useState('USD');
  const [priceUnit, setPriceUnit] = useState('kg');
  const [priceMinQty, setPriceMinQty] = useState('1');
  const [priceValidFrom, setPriceValidFrom] = useState(new Date().toISOString().split('T')[0]);
  const [priceValidUntil, setPriceValidUntil] = useState('');
  const [priceNotes, setPriceNotes] = useState('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filtered products
  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search ||
      p.name.toLowerCase().includes(q) ||
      (p.code && p.code.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q));

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && p.active) ||
      (statusFilter === 'INACTIVE' && !p.active);

    return matchesSearch && matchesStatus;
  });

  const handleOpenAdd = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setFormCode('');
    setFormName('');
    setFormCategory('');
    setFormDesc('');
    setFormActive(true);
    setIsAddOpen(true);
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!formName.trim()) {
      setErrorMsg('Mahsulot nomi kiritilishi shart.');
      return;
    }

    startTransition(async () => {
      const res = await createProductAction({
        code: formCode.trim() || undefined,
        name: formName.trim(),
        category: formCategory.trim() || undefined,
        description: formDesc.trim() || undefined,
        active: formActive,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Mahsulot qo‘shishda xatolik yuz berdi');
      } else {
        setSuccessMsg(`Mahsulot "${formName}" muvaffaqiyatli qo‘shildi.`);
        setIsAddOpen(false);
        if (res.data) {
          setProducts((prev) => [res.data as ProductItem, ...prev]);
        }
      }
    });
  };

  const handleOpenEdit = (p: ProductItem) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setEditingProduct(p);
    setFormName(p.name);
    setFormCategory(p.category || '');
    setFormDesc(p.description || '');
    setFormActive(p.active);
  };

  const handleUpdateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setErrorMsg(null);

    startTransition(async () => {
      const res = await updateProductAction(editingProduct.id, {
        name: formName.trim(),
        category: formCategory.trim() || undefined,
        description: formDesc.trim() || undefined,
        active: formActive,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Mahsulotni tahrirlashda xatolik');
      } else {
        setSuccessMsg(`Mahsulot tahrirlandi.`);
        setProducts((prev) =>
          prev.map((item) =>
            item.id === editingProduct.id
              ? { ...item, ...(res.data as Partial<ProductItem>) }
              : item
          )
        );
        setEditingProduct(null);
      }
    });
  };

  const handleToggleActive = (p: ProductItem) => {
    const newStatus = !p.active;
    startTransition(async () => {
      const res = await toggleProductActiveAction(p.id, newStatus);
      if (res.success) {
        setProducts((prev) =>
          prev.map((item) => (item.id === p.id ? { ...item, active: newStatus } : item))
        );
        setSuccessMsg(`Mahsulot ${newStatus ? 'faollashtirildi' : 'faolsizlantirildi'}.`);
      } else {
        setErrorMsg(res.error || 'Statusni o‘zgartirishda xatolik');
      }
    });
  };

  const handleAddPrice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pricingProduct) return;
    setErrorMsg(null);

    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg('Narx miqdori 0 dan strictly katta bo‘lishi kerak.');
      return;
    }

    startTransition(async () => {
      const res = await createPriceAction({
        productId: pricingProduct.id,
        amount: amt,
        currency: priceCurrency,
        unit: priceUnit,
        minimumQuantity: parseFloat(priceMinQty) || 1,
        validFrom: priceValidFrom,
        validUntil: priceValidUntil || undefined,
        notes: priceNotes.trim() || undefined,
        active: true,
      });

      if (!res.success) {
        setErrorMsg(res.error || 'Narx qo‘shishda xatolik');
      } else {
        setSuccessMsg('Yangi ACTIVE narx saqlandi.');
        const newRecord = res.data as PriceRecord;
        setPricesMap((prev) => {
          const list = prev[pricingProduct.id] || [];
          const updatedList = list.map((p) => ({ ...p, active: false }));
          return { ...prev, [pricingProduct.id]: [newRecord, ...updatedList] };
        });
        setPriceAmount('');
        setPriceNotes('');
      }
    });
  };

  const handleDeactivatePrice = (priceId: string) => {
    if (!pricingProduct) return;
    startTransition(async () => {
      const res = await deactivatePriceAction(priceId);
      if (res.success) {
        setPricesMap((prev) => {
          const list = prev[pricingProduct.id] || [];
          return {
            ...prev,
            [pricingProduct.id]: list.map((p) => (p.id === priceId ? { ...p, active: false } : p)),
          };
        });
        setSuccessMsg('Narx faolsizlantirildi.');
      } else {
        setErrorMsg(res.error || 'Narxni faolsizlantirishda xatolik');
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

      {/* Control Panel */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Qidiruv (nomi, kodi, kategoriya)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '280px' }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
            style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            <option value="ALL">Barcha statuslar</option>
            <option value="ACTIVE">Faqat ACTIVE</option>
            <option value="INACTIVE">Faqat INACTIVE</option>
          </select>
        </div>

        <button
          onClick={handleOpenAdd}
          style={{
            padding: '10px 18px',
            backgroundColor: '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Mahsulot Qo‘shish
        </button>
      </div>

      {/* Products Table */}
      <div className="table-wrap" style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
              <th style={{ padding: '12px' }}>Kod</th>
              <th style={{ padding: '12px' }}>Nomi</th>
              <th style={{ padding: '12px' }}>Kategoriya</th>
              <th style={{ padding: '12px' }}>Amaldagi Narx</th>
              <th style={{ padding: '12px' }}>Status</th>
              <th style={{ padding: '12px' }}>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                  Mahsulotlar topilmadi.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const pPrices = pricesMap[p.id] || [];
                const activePrice = pPrices.find((pr) => pr.active);

                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px' }}>
                      <strong style={{ fontFamily: 'monospace' }}>{p.code || '—'}</strong>
                    </td>
                    <td style={{ padding: '12px' }}>{p.name}</td>
                    <td style={{ padding: '12px', color: '#64748b' }}>{p.category || '—'}</td>
                    <td style={{ padding: '12px' }}>
                      {activePrice ? (
                        <span style={{ color: '#166534', fontWeight: 600 }}>
                          {activePrice.price} {activePrice.currency} / {activePrice.unit}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '13px' }}>Narx kiritilmagan</span>
                      )}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: p.active ? '#dcfce7' : '#f1f5f9',
                          color: p.active ? '#166534' : '#64748b',
                        }}
                      >
                        {p.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleOpenEdit(p)}
                          style={{ padding: '6px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Tahrirlash
                        </button>
                        <button
                          onClick={() => setPricingProduct(p)}
                          style={{ padding: '6px 12px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Narxlar ({pPrices.length})
                        </button>
                        <button
                          onClick={() => handleToggleActive(p)}
                          disabled={isPending}
                          style={{
                            padding: '6px 12px',
                            background: p.active ? '#fee2e2' : '#dcfce7',
                            color: p.active ? '#991b1b' : '#166534',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          {p.active ? 'Faolsizlantirish' : 'Faollashtirish'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      {isAddOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <form onSubmit={handleCreateProduct} style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '420px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3>Yangi Mahsulot Qo‘shish</h3>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Mahsulot kodi (unikal, masalan: 30/70)</label>
              <input type="text" value={formCode} onChange={(e) => setFormCode(e.target.value)} placeholder="30/70" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Mahsulot nomi *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Kategoriya</label>
              <input type="text" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} placeholder="Yarns" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Tavsif</label>
              <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={3} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} id="addActive" />
              <label htmlFor="addActive">Active status</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button type="button" onClick={() => setIsAddOpen(false)} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Bekor qilish</button>
              <button type="submit" disabled={isPending} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Saqlash</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <form onSubmit={handleUpdateProduct} style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '420px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3>Mahsulotni Tahrirlash</h3>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Mahsulot kodi (o‘zgarmaydi)</label>
              <input type="text" value={editingProduct.code || ''} disabled style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', background: '#f1f5f9' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Mahsulot nomi *</label>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} required style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Kategoriya</label>
              <input type="text" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>Tavsif</label>
              <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} rows={3} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} id="editActive" />
              <label htmlFor="editActive">Active status</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button type="button" onClick={() => setEditingProduct(null)} style={{ padding: '8px 16px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Bekor qilish</button>
              <button type="submit" disabled={isPending} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Yangilash</button>
            </div>
          </form>
        </div>
      )}

      {/* Pricing Modal & History Drawer */}
      {pricingProduct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', width: '560px', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Narxlar Boshqaruvi: {pricingProduct.name}</h3>
              <button onClick={() => setPricingProduct(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>

            {/* Add Price Form */}
            <form onSubmit={handleAddPrice} style={{ padding: '16px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <strong style={{ fontSize: '14px' }}>Yangi Active Narx Qo‘shish</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '12px' }}>Narx miqdori *</label>
                  <input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} required placeholder="4.50" style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px' }}>Valyuta</label>
                  <select value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}>
                    <option value="USD">USD</option>
                    <option value="UZS">UZS</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px' }}>O‘lchov birligi</label>
                  <input type="text" value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px' }}>Min buyurtma (MOQ)</label>
                  <input type="number" value={priceMinQty} onChange={(e) => setPriceMinQty(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px' }}>Amal qilish boshlanishi</label>
                  <input type="date" value={priceValidFrom} onChange={(e) => setPriceValidFrom(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px' }}>Amal qilish tugashi (ixtiyoriy)</label>
                  <input type="date" value={priceValidUntil} onChange={(e) => setPriceValidUntil(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                </div>
              </div>
              <button type="submit" disabled={isPending} style={{ padding: '8px', background: '#166534', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', marginTop: '4px' }}>
                + Active Narxni Saqlash
              </button>
            </form>

            {/* Price History Table */}
            <div>
              <strong style={{ fontSize: '14px', display: 'block', marginBottom: '8px' }}>Narxlar Tarixi:</strong>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={{ padding: '8px' }}>Narx</th>
                    <th style={{ padding: '8px' }}>Boshlanishi</th>
                    <th style={{ padding: '8px' }}>Status</th>
                    <th style={{ padding: '8px' }}>Amal</th>
                  </tr>
                </thead>
                <tbody>
                  {(pricesMap[pricingProduct.id] || []).length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>Hozircha narx yozuvlari yo‘q</td></tr>
                  ) : (
                    (pricesMap[pricingProduct.id] || []).map((pr) => (
                      <tr key={pr.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '8px' }}><strong>{pr.price} {pr.currency}</strong> / {pr.unit}</td>
                        <td style={{ padding: '8px' }}>{new Date(pr.validFrom).toLocaleDateString()}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, background: pr.active ? '#dcfce7' : '#f1f5f9', color: pr.active ? '#166534' : '#64748b' }}>
                            {pr.active ? 'ACTIVE (Bot Foydalanadi)' : 'INACTIVE (Tarix)'}
                          </span>
                        </td>
                        <td style={{ padding: '8px' }}>
                          {pr.active && (
                            <button onClick={() => handleDeactivatePrice(pr.id)} style={{ padding: '4px 8px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                              Faolsizlantirish
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
