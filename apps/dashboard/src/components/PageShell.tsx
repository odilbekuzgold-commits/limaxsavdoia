import Link from 'next/link';
import { Sidebar } from './layout/Sidebar';

export function PageShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="header-bar" style={{ marginBottom: '20px' }}>
          <div>
            <Link href="/dashboard" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary)', marginBottom: '8px', display: 'inline-block' }}>
              ← Asosiy panelga qaytish
            </Link>
            <h1 style={{ margin: '4px 0', fontSize: '24px', fontWeight: 800 }}>{title}</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>{description}</p>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state" style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '16px', padding: '48px 20px' }}>
      <strong>Hozircha ma’lumot yo‘q</strong>
      <p>{children}</p>
    </div>
  );
}
