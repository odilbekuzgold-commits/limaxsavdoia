'use client';

import type { DashboardTopProduct } from '@limax/shared';

interface TopProductsProps {
  products?: DashboardTopProduct[];
  loading?: boolean;
}

export function TopProducts({ products = [], loading }: TopProductsProps) {
  return (
    <div className={`panel-card ${loading ? 'loading-skeleton' : ''}`}>
      <div className="panel-head">
        <div>
          <h3>Eng ko‘p so‘ralgan ip mahsulotlari</h3>
          <p>Mijozlar tomonidan eng ko‘p qiziqish bildirilgan top-5 ip va polyester turlari</p>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="empty-state">
          <p>Hozircha so‘rovlar bo‘yicha ma'lumot yo‘q</p>
        </div>
      ) : (
        <div className="product-list">
          {products.map((p) => (
            <div key={p.name} className="product-item">
              <div className="product-info">
                <div>
                  <span className={`product-rank ${p.rank === 1 ? 'top1' : ''}`}>#{p.rank}</span>
                  <span className="product-name">{p.name}</span>
                </div>
                <div className="product-stats">
                  <span className="product-count">{p.count} ta so‘rov</span>
                  <span className="legend-percent">({p.percentage}%)</span>
                </div>
              </div>

              <div className="product-bar-bg">
                <div className="product-bar-fill" style={{ width: `${Math.min(100, Math.max(5, p.percentage))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
