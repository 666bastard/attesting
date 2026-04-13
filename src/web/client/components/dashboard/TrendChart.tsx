import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { DashboardSummary } from '../../lib/api';

interface Props {
  trend: DashboardSummary['trend'];
}

export default function TrendChart({ trend }: Props) {
  const data = trend.points.map((p) => ({
    timestamp: p.calculated_at,
    label: new Date(p.calculated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: Number(p.overall_score.toFixed(2)),
  }));

  const hasData = data.length >= 2;

  return (
    <div className="glass-static rounded-2xl p-5 h-full">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Compliance Trend
        </h3>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          last {trend.since_days} days
        </span>
      </div>
      {hasData ? (
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 5, right: 8, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                stroke="var(--border-subtle)"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                stroke="var(--border-subtle)"
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-glass-strong)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'var(--text-tertiary)' }}
                itemStyle={{ color: 'var(--text-primary)' }}
              />
              <ReferenceLine y={80} stroke="#4ade8044" strokeDasharray="3 3" />
              <ReferenceLine y={60} stroke="#fbbf2444" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#818cf8"
                strokeWidth={2}
                dot={{ r: 3, fill: '#818cf8' }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[200px] flex items-center justify-center text-center">
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            Take at least two snapshots to see a trend.
          </p>
        </div>
      )}
    </div>
  );
}
