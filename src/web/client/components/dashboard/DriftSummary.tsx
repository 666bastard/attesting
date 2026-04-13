import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DashboardSummary } from '../../lib/api';

interface Props {
  drift: DashboardSummary['drift'];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#fb7185',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#4ade80',
  info: '#818cf8',
};

export default function DriftSummary({ drift }: Props) {
  const bySeverity = new Map(drift.by_severity.map((r) => [r.severity, r.count]));

  return (
    <div className="glass-static rounded-2xl p-5 h-full">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Drift Alerts
        </h3>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {drift.active} active
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2 mb-5">
        {['critical', 'high', 'medium', 'low', 'info'].map((sev) => {
          const count = bySeverity.get(sev) ?? 0;
          const color = SEVERITY_COLORS[sev];
          return (
            <div
              key={sev}
              className="rounded-lg p-2 text-center"
              style={{
                background: 'var(--bg-glass-strong)',
                boxShadow: count > 0 ? `inset 0 0 0 1px ${color}44` : undefined,
              }}
            >
              <p className="text-lg font-semibold tabular-nums" style={{ color: count > 0 ? color : 'var(--text-dim)' }}>
                {count}
              </p>
              <p className="text-[9px] uppercase" style={{ color: 'var(--text-dim)' }}>{sev}</p>
            </div>
          );
        })}
      </div>

      {drift.recent.length > 0 ? (
        <>
          <h4 className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
            Recent
          </h4>
          <ul className="space-y-1.5">
            {drift.recent.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[11px]">
                <AlertTriangle
                  className="h-3 w-3 shrink-0"
                  style={{ color: SEVERITY_COLORS[a.severity] ?? 'var(--text-dim)' }}
                  aria-hidden="true"
                />
                <span className="truncate flex-1" style={{ color: 'var(--text-primary)' }} title={a.title}>
                  {a.title}
                </span>
                <span className="shrink-0 font-mono" style={{ color: 'var(--text-dim)' }}>
                  {formatRelative(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[11px] text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
          No active alerts — all clear.
        </p>
      )}
    </div>
  );
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
