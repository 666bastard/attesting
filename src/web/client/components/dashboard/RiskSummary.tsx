import React from 'react';
import type { DashboardSummary } from '../../lib/api';

interface Props {
  risk: DashboardSummary['risk'];
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#fb7185',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#4ade80',
  info: '#818cf8',
};

export default function RiskSummary({ risk }: Props) {
  const bySeverity = new Map(risk.by_severity.map((r) => [r.severity, r.count]));
  const max = Math.max(1, ...risk.by_severity.map((r) => r.count));

  return (
    <div className="glass-static rounded-2xl p-5 h-full">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Risk Posture
        </h3>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {risk.total_open} open
        </span>
      </div>

      <div className="space-y-2 mb-5">
        {SEVERITY_ORDER.map((sev) => {
          const count = bySeverity.get(sev) ?? 0;
          const pct = (count / max) * 100;
          const color = SEVERITY_COLORS[sev];
          return (
            <div key={sev} className="flex items-center gap-3">
              <span className="text-[10px] uppercase font-medium w-16" style={{ color: 'var(--text-dim)' }}>
                {sev}
              </span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-glass-strong)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: color,
                    boxShadow: count > 0 ? `0 0 6px ${color}66` : 'none',
                  }}
                />
              </div>
              <span className="text-[11px] tabular-nums w-8 text-right" style={{ color: 'var(--text-primary)' }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {risk.top.length > 0 && (
        <>
          <h4 className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
            Top Risks
          </h4>
          <ul className="space-y-1.5">
            {risk.top.slice(0, 5).map((r) => (
              <li key={r.risk_id} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono shrink-0" style={{ color: 'var(--text-dim)' }}>{r.risk_id}</span>
                <span className="truncate flex-1" style={{ color: 'var(--text-primary)' }} title={r.title}>
                  {r.title}
                </span>
                <span className="tabular-nums shrink-0 font-medium" style={{ color: scoreColor(r.inherent_risk_score) }}>
                  {r.inherent_risk_score}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 20) return '#fb7185';
  if (score >= 15) return '#fb923c';
  if (score >= 9)  return '#fbbf24';
  return '#4ade80';
}
