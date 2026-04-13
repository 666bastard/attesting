import React from 'react';
import { ShieldCheck, AlertTriangle, Activity, ClipboardList, Flame } from 'lucide-react';
import type { DashboardSummary } from '../../lib/api';

interface Props {
  summary: DashboardSummary;
}

/**
 * Top row of compact KPI cards. Each tile is clickable-agnostic (no nav yet).
 */
export default function KpiCards({ summary }: Props) {
  const coveragePct = summary.coverage.implemented_pct;
  const tiles = [
    {
      label: 'Compliance',
      value: `${summary.compliance.overall_score.toFixed(0)}%`,
      sub: `${summary.compliance.catalog_count} framework${summary.compliance.catalog_count === 1 ? '' : 's'}`,
      icon: ShieldCheck,
      color: colorForScore(summary.compliance.overall_score),
    },
    {
      label: 'Coverage',
      value: `${coveragePct.toFixed(0)}%`,
      sub: `${summary.coverage.implemented}/${summary.coverage.effective_total} controls`,
      icon: Activity,
      color: colorForScore(coveragePct),
    },
    {
      label: 'Open Risks',
      value: summary.risk.total_open.toLocaleString(),
      sub: summary.risk.above_appetite > 0 ? `${summary.risk.above_appetite} above appetite` : 'within appetite',
      icon: Flame,
      color: summary.risk.above_appetite > 0 ? 'rose' : 'emerald',
    },
    {
      label: 'Drift Alerts',
      value: summary.drift.active.toLocaleString(),
      sub: summary.drift.pending_dispositions > 0 ? `${summary.drift.pending_dispositions} pending review` : 'all reviewed',
      icon: AlertTriangle,
      color: summary.drift.active > 0 ? 'amber' : 'emerald',
    },
    {
      label: 'POA&M Overdue',
      value: summary.poam.overdue.toLocaleString(),
      sub: `${summary.poam.total_open} open items`,
      icon: ClipboardList,
      color: summary.poam.overdue > 0 ? 'rose' : 'emerald',
    },
  ];

  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" aria-label="Executive KPIs">
      {tiles.map((t) => (
        <div key={t.label} className="glass-static px-5 py-4 rounded-2xl">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-dim)' }}>
                {t.label}
              </p>
              <p className="text-2xl font-semibold mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {t.value}
              </p>
              <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
                {t.sub}
              </p>
            </div>
            <div
              className="p-2 rounded-lg shrink-0"
              style={{
                background: 'var(--bg-glass-strong)',
                boxShadow: glowFor(t.color),
              }}
            >
              <t.icon className={`h-4 w-4 ${iconClassFor(t.color)}`} aria-hidden="true" />
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function colorForScore(n: number): 'emerald' | 'amber' | 'rose' {
  if (n >= 80) return 'emerald';
  if (n >= 60) return 'amber';
  return 'rose';
}

function iconClassFor(color: string): string {
  switch (color) {
    case 'emerald': return 'text-emerald-400';
    case 'amber':   return 'text-amber-400';
    case 'rose':    return 'text-rose-400';
    default:        return 'text-indigo-400';
  }
}

function glowFor(color: string): string {
  switch (color) {
    case 'emerald': return 'var(--glow-green)';
    case 'amber':   return 'var(--glow-amber)';
    case 'rose':    return 'var(--glow-rose)';
    default:        return 'var(--glow-indigo)';
  }
}
