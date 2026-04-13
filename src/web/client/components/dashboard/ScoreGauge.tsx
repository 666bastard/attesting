import React from 'react';

interface Props {
  score: number;
  label?: string;
  size?: number;
}

/**
 * Large circular score gauge with color-coded ring.
 * Colors: >=80 green, >=60 amber, else rose.
 */
export default function ScoreGauge({ score, label = 'Overall Score', size = 180 }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - 24) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  const color = clamped >= 80 ? '#4ade80' : clamped >= 60 ? '#fbbf24' : '#fb7185';
  const glow = clamped >= 80 ? 'var(--glow-green)' : clamped >= 60 ? 'var(--glow-amber)' : 'var(--glow-rose)';

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size, height: size, filter: `drop-shadow(0 0 12px ${color}44)` }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth="10"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-4xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)', textShadow: `0 0 24px ${color}88` }}>
            {clamped.toFixed(0)}
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            / 100
          </span>
        </div>
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-dim)' }}>
        {label}
      </p>
    </div>
  );
}
