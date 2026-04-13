import React from 'react';
import { Activity, AlertCircle, TrendingDown, MinusCircle } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { getMonitoringStatus } from '../../lib/api';

/**
 * Phase 8D — Continuous monitoring widget.
 *
 * Renders the read-only state returned by GET /api/monitoring/status:
 * threshold/delta/trend breach counts plus a per-snapshot findings list
 * highlighting which catalogs need attention.
 */
export default function MonitoringPanel() {
  const { data, loading, error } = useApi(() => getMonitoringStatus(), []);

  if (loading && !data) {
    return <div className="glass-static rounded-2xl h-48 animate-pulse" />;
  }

  if (error) {
    return (
      <div className="glass-static rounded-2xl p-5">
        <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          Monitoring unavailable: {error}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const tiles = [
    { label: 'Threshold breaches', value: data.summary.threshold_breaches, icon: AlertCircle, color: '#fb7185' },
    { label: 'Delta drops',        value: data.summary.delta_breaches,     icon: TrendingDown, color: '#fb923c' },
    { label: 'Sustained decline',  value: data.summary.trend_breaches,     icon: MinusCircle,  color: '#fbbf24' },
    { label: 'Checked',            value: data.summary.total_checked,      icon: Activity,     color: '#818cf8' },
  ];

  const offenders = data.findings
    .filter((f) => f.threshold_breached || f.delta_breached || f.trend_breached)
    .slice(0, 6);

  return (
    <div className="glass-static rounded-2xl p-5 h-full">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Continuous Monitoring
        </h3>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {new Date(data.generated_at).toLocaleTimeString()}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-5">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg p-2"
            style={{
              background: 'var(--bg-glass-strong)',
              boxShadow: t.value > 0 ? `inset 0 0 0 1px ${t.color}44` : undefined,
            }}
          >
            <div className="flex items-center justify-between mb-0.5">
              <t.icon
                className="h-3 w-3"
                style={{ color: t.value > 0 ? t.color : 'var(--text-dim)' }}
                aria-hidden="true"
              />
              <span
                className="text-lg font-semibold tabular-nums leading-none"
                style={{ color: t.value > 0 ? t.color : 'var(--text-primary)' }}
              >
                {t.value}
              </span>
            </div>
            <p className="text-[9px] uppercase leading-tight" style={{ color: 'var(--text-dim)' }}>
              {t.label}
            </p>
          </div>
        ))}
      </div>

      {offenders.length > 0 ? (
        <>
          <h4 className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
            Needs attention
          </h4>
          <ul className="space-y-1.5">
            {offenders.map((f) => (
              <li
                key={`${f.catalog_id}:${f.scope_id ?? 'org'}`}
                className="flex items-center gap-2 text-[11px]"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: f.threshold_breached ? '#fb7185' : f.delta_breached ? '#fb923c' : '#fbbf24' }}
                />
                <span
                  className="truncate flex-1"
                  style={{ color: 'var(--text-primary)' }}
                  title={f.catalog_short_name ?? f.catalog_id}
                >
                  {f.catalog_short_name ?? f.catalog_id.substring(0, 8)}
                </span>
                <span className="tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {f.current_score.toFixed(0)}
                  {f.delta !== null && f.delta !== 0 && (
                    <span className="ml-1" style={{ color: f.delta > 0 ? '#fb7185' : '#4ade80' }}>
                      {f.delta > 0 ? '▼' : '▲'}{Math.abs(f.delta).toFixed(1)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[11px] text-center py-3" style={{ color: 'var(--text-tertiary)' }}>
          All catalogs within thresholds.
        </p>
      )}
    </div>
  );
}
