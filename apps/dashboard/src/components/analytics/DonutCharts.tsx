'use client';

import type { DashboardLeadSummary, DashboardAiSummary } from '@limax/shared';

interface DonutChartsProps {
  leadSummary?: DashboardLeadSummary;
  aiSummary?: DashboardAiSummary;
  loading?: boolean;
}

function SvgDonut({
  segments,
  total,
}: {
  segments: Array<{ value: number; color: string }>;
  total: number;
}) {
  const radius = 52;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercent = 0;

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="transparent"
        stroke="#eef2ef"
        strokeWidth={strokeWidth}
      />
      {total > 0 &&
        segments.map((seg, i) => {
          const percent = seg.value / total;
          const strokeDasharray = `${percent * circumference} ${circumference}`;
          const strokeDashoffset = -cumulativePercent * circumference;
          cumulativePercent += percent;

          return (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={radius}
              fill="transparent"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 70 70)"
              strokeLinecap="round"
              style={{ transition: 'all 0.5s ease' }}
            />
          );
        })}
    </svg>
  );
}

export function DonutCharts({ leadSummary, aiSummary, loading }: DonutChartsProps) {
  const totalLeads = leadSummary?.totalLeads ?? 0;
  const qualLeads = leadSummary?.qualifiedLeads ?? 0;
  const unqualLeads = leadSummary?.unqualifiedLeads ?? 0;

  const qualPercent = totalLeads > 0 ? Math.round((qualLeads / totalLeads) * 100) : 0;
  const unqualPercent = totalLeads > 0 ? Math.round((unqualLeads / totalLeads) * 100) : 0;

  const aiProcessed = aiSummary?.aiProcessed ?? 0;
  const mgrRouted = aiSummary?.managerRouted ?? 0;
  const aiTotal = aiSummary?.totalLeads ?? 0;
  const aiPercent = aiSummary?.aiPercent ?? 0;
  const mgrPercent = aiSummary?.managerPercent ?? 0;

  return (
    <div className={`dashboard-row-2 ${loading ? 'loading-skeleton' : ''}`}>
      {/* 1. Leadlar sifati Donut */}
      <div className="panel-card">
        <div className="panel-head">
          <div>
            <h3>Leadlar sifati</h3>
            <p>Malakalangan va malakalanmagan leadlar nisbati</p>
          </div>
        </div>

        <div className="donut-container">
          <div className="donut-svg-wrap">
            <SvgDonut
              total={totalLeads}
              segments={[
                { value: qualLeads, color: '#10b981' },
                { value: unqualLeads, color: '#f59e0b' },
              ]}
            />
            <div className="donut-center-text">
              <strong>{totalLeads}</strong>
              <small>Jami</small>
            </div>
          </div>

          <div className="donut-legend">
            <div className="legend-item">
              <div className="legend-left">
                <span className="legend-dot" style={{ background: '#10b981' }} />
                <span>Sifatli leadlar</span>
              </div>
              <div>
                <span className="legend-val">{qualLeads}</span>
                <span className="legend-percent">({qualPercent}%)</span>
              </div>
            </div>

            <div className="legend-item">
              <div className="legend-left">
                <span className="legend-dot" style={{ background: '#f59e0b' }} />
                <span>Sifatsiz leadlar</span>
              </div>
              <div>
                <span className="legend-val">{unqualLeads}</span>
                <span className="legend-percent">({unqualPercent}%)</span>
              </div>
            </div>

            <div className="legend-item" style={{ borderTop: '1px solid #f0f4f1', paddingTop: '8px' }}>
              <div className="legend-left">
                <strong>Jami leadlar</strong>
              </div>
              <div>
                <strong className="legend-val">{totalLeads}</strong>
                <span className="legend-percent">(100%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. AI ishlash statistikasi Donut */}
      <div className="panel-card">
        <div className="panel-head">
          <div>
            <h3>AI ishlash statistikasi</h3>
            <p>AI tomonidan qayta ishlangan va menejerga yo‘naltirilgan suhbatlar</p>
          </div>
        </div>

        <div className="donut-container">
          <div className="donut-svg-wrap">
            <SvgDonut
              total={aiTotal}
              segments={[
                { value: aiProcessed, color: '#8b5cf6' },
                { value: mgrRouted, color: '#3b82f6' },
              ]}
            />
            <div className="donut-center-text">
              <strong>{aiTotal}</strong>
              <small>Jami</small>
            </div>
          </div>

          <div className="donut-legend">
            <div className="legend-item">
              <div className="legend-left">
                <span className="legend-dot" style={{ background: '#8b5cf6' }} />
                <span>AI qayta ishlagan</span>
              </div>
              <div>
                <span className="legend-val">{aiProcessed}</span>
                <span className="legend-percent">({aiPercent}%)</span>
              </div>
            </div>

            <div className="legend-item">
              <div className="legend-left">
                <span className="legend-dot" style={{ background: '#3b82f6' }} />
                <span>Menejerga yo‘naltirilgan</span>
              </div>
              <div>
                <span className="legend-val">{mgrRouted}</span>
                <span className="legend-percent">({mgrPercent}%)</span>
              </div>
            </div>

            <div className="legend-item" style={{ borderTop: '1px solid #f0f4f1', paddingTop: '8px' }}>
              <div className="legend-left">
                <strong>Jami suhbatlar</strong>
              </div>
              <div>
                <strong className="legend-val">{aiTotal}</strong>
                <span className="legend-percent">(100%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
