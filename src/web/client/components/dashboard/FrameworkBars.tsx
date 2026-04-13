import React from 'react';
import type { FrameworkScore } from '../../lib/api';

interface Props {
  frameworks: FrameworkScore[];
}

export default function FrameworkBars({ frameworks }: Props) {
  const sorted = [...frameworks].sort((a, b) => b.overall_score - a.overall_score);

  return (
    <div className="glass-static rounded-2xl p-5 h-full">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-dim)' }}>
        Score by Framework
      </h3>
      {sorted.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          No catalogs imported yet.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((f) => {
            const score = f.overall_score ?? 0;
            const color = score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : '#fb7185';
            return (
              <div key={f.catalog_id}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[12px] font-medium truncate pr-2" style={{ color: 'var(--text-primary)' }}>
                    {f.catalog_name ?? f.catalog_short_name ?? f.catalog_id}
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-dim)' }}>
                    {score.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-glass-strong)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(0, Math.min(100, score))}%`,
                      background: color,
                      boxShadow: `0 0 8px ${color}66`,
                    }}
                  />
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {f.implemented_count}/{f.total_controls} implemented · {(f.coverage_score ?? 0).toFixed(0)}% coverage
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
