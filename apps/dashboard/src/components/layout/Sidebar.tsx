'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItemDef {
  label: string;
  href: string;
  icon: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItemDef[] = [
  { label: 'Asosiy panel', href: '/dashboard', icon: '⌂' },
  { label: 'Leadlar', href: '/dashboard/leads', icon: '↗' },
  { label: 'AI tahlil', href: '/dashboard/analytics', icon: '✦' },
  { label: 'Menejerlar', href: '/dashboard/employees', icon: '👤' },
  { label: 'Mijozlar', href: '/dashboard/customers', icon: '👥' },
  { label: 'Mahsulotlar', href: '/dashboard/products', icon: '◇' },
  { label: 'Manbalar', href: '#sources', icon: '🌐', disabled: true },
  { label: 'Uchrashuvlar', href: '#meetings', icon: '📅', disabled: true },
  { label: 'Namuna so‘rovlari', href: '#samples', icon: '📦', disabled: true },
  { label: 'Takliflar', href: '#offers', icon: '📄', disabled: true },
  { label: 'Hisobotlar', href: '#reports', icon: '📊', disabled: true },
  { label: 'Sozlamalar', href: '/dashboard/settings', icon: '⚙' },
];

export function Sidebar({ apiOnline = true }: { apiOnline?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">L</div>
        <div className="brand-info">
          <strong>LImax</strong>
          <small>Yarn Analytics</small>
        </div>
      </div>

      <nav>
        <div className="nav-section-title">Navigatsiya</div>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));

          if (item.disabled) {
            return (
              <div key={item.label} className="nav-item disabled" title="Ushbu bo‘lim tez orada ishga tushadi">
                <span className="icon">{item.icon}</span>
                <span>{item.label}</span>
                <span className="badge-soon">Tez orada</span>
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="side-bottom">
        <div className={`system-dot ${apiOnline ? 'online' : ''}`} />
        <div>
          <strong>{apiOnline ? 'Tizim ishlamoqda' : 'API bilan aloqa yo‘q'}</strong>
          <small>LImax Engine v2.0</small>
        </div>
      </div>
    </aside>
  );
}
