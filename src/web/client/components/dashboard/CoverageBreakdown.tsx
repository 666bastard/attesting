import React from 'react';
import type { DashboardSummary } from '../../lib/api';

interface Props {
  coverage: DashboardSummary['coverage'];
  evidence: DashboardSummary['evidence'];
  poam: DashboardSummary['poam'];
}

export default function CoverageBreakdown({ coverage, evidence, poam }: Props) {
  const buckets = [
    { label: 'Implemented', value: coverage.implemented, color: '#4ade80' },
    { label: 'Alternative', value: coverage.alternative, color: '#22d3ee' },
    { label: 'Partial',     value: coverage.partial,     color: '#fbbf24' },
    { label: 'Planned',     value: coverage.planned,     color: '#a78bfa' },
    { label: 'Gap',         value: coverage.not_implemented, color: '#fb7185' },
    { label: 'N/A',         value: coverage.not_applicable,  color: '#6b7280' },
  ];
  const total = Math.max(1, coverage.total_controls);

  return (
    <div className="glass-static rounded-2xl p-5 h-full">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-dim)' }}>
        Control Coverage
      </h3>

      {/* Stacked horizontal bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-3" style={{ background: 'var(--bg-glass-strong)' }}>
        {buckets.map((b) => {
          const pct = (b.value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={b.label}
              style={{
                width: `${pct}%`,
                background: b.color,
                boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.1)`,
              }}
              title={`${b.label}: ${b.value}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-5">
        {buckets.map((b) => (
          <li key={b.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: b.color }} />
            <span className="flex-1" style={{ color: 'var(--text-tertiary)' }}>{b.label}</span>
            <span className="tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>{b.value}</span>
          </li>
        ))}
      </ul>

      {/* Evidence + POAM strip */}
      <div className="pt-4 border-t grid grid-cols-2 gap-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Evidence</p>
          <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {evidence.fresh_pct.toFixed(0)}%
            <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--text-tertiary)' }}>fresh</span>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {evidence.fresh}/{evidence.total} · {evidence.expiring_soon} expiring
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>POA&M</p>
          <p className="text-lg font-semibold tabular-nums" style={{ color: poam.overdue > 0 ? '#fb7185' : 'var(--text-primary)' }}>
            {poam.total_open}
            <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--text-tertiary)' }}>open</span>
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {poam.overdue} overdue
          </p>
        </div>
      </div>
    </div>
  );
}
