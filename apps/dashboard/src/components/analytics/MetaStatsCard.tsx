'use client';

interface MetaStatsCardProps {
  meta?: {
    connected: boolean;
    message: string;
  } | null;
}

export function MetaStatsCard({ meta }: MetaStatsCardProps) {
  const isConnected = meta?.connected ?? false;

  if (!isConnected) {
    return (
      <div className="meta-unconnected-card">
        <div className="meta-icon">📣</div>
        <div className="meta-info">
          <h4>Meta (Facebook / Instagram Ads) statistikasi</h4>
          <p>Meta Ads reklama akkaunti hozirda tizimga ulangan emas. Integratsiya yoqilgach CTR, CPL va reklama leadlari avtomatik ko‘rinadi.</p>
        </div>
        <div className="meta-tag">Meta integration ulanmagan</div>
      </div>
    );
  }

  return null;
}
