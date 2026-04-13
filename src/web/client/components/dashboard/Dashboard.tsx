import React from 'react';
import { RefreshCw, Printer } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { getDashboardSummary } from '../../lib/api';
import ScoreGauge from './ScoreGauge';
import KpiCards from './KpiCards';
import TrendChart from './TrendChart';
import FrameworkBars from './FrameworkBars';
import RiskSummary from './RiskSummary';
import DriftSummary from './DriftSummary';
import CoverageBreakdown from './CoverageBreakdown';
import MonitoringPanel from './MonitoringPanel';

interface DashboardProps {
  scope: string;
}

/**
 * Phase 8B Executive Dashboard.
 *
 * Single-page leadership summary backed by GET /api/dashboard/summary.
 * All KPIs come from one aggregation call to avoid waterfall fetches.
 */
export default function Dashboard({ scope }: DashboardProps) {
  const { data: summary, loading, error, refetch } = useApi(
    () => getDashboardSummary(scope || undefined),
    [scope],
  );

  if (loading && !summary) {
    return (
      <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="glass-static rounded-2xl h-24 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-static rounded-2xl h-64 animate-pulse" />
          <div className="glass-static rounded-2xl h-64 animate-pulse lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
        <div className="glass-static rounded-2xl p-10 text-center">
          <p className="text-[13px] mb-2" style={{ color: 'var(--text-rose, #fb7185)' }}>
            Failed to load dashboard: {error}
          </p>
          <button onClick={refetch} className="text-[12px] underline" style={{ color: 'var(--text-tertiary)' }}>
            retry
          </button>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6 print:space-y-4 print:p-4">
      <header className="flex items-center justify-between print:mb-2">
        <div>
          <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Executive Dashboard
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
            {summary.scope.id ? `Scope: ${summary.scope.ref}` : 'Organization-wide posture'}
            {' · '}
            Generated {new Date(summary.generated_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={refetch}
            className="glass-static px-3 py-1.5 rounded-lg text-[11px] flex items-center gap-1.5 hover:bg-white/5 transition"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label="Refresh dashboard"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Refresh
          </button>
          <button
            onClick={() => window.print()}
            className="glass-static px-3 py-1.5 rounded-lg text-[11px] flex items-center gap-1.5 hover:bg-white/5 transition"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label="Print dashboard"
          >
            <Printer className="h-3 w-3" aria-hidden="true" />
            Print
          </button>
        </div>
      </header>

      <KpiCards summary={summary} />

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-static rounded-2xl p-6 flex items-center justify-center">
          <ScoreGauge score={summary.compliance.overall_score} label="Compliance Score" />
        </div>
        <div className="lg:col-span-2">
          <TrendChart trend={summary.trend} />
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FrameworkBars frameworks={summary.frameworks} />
        <CoverageBreakdown
          coverage={summary.coverage}
          evidence={summary.evidence}
          poam={summary.poam}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RiskSummary risk={summary.risk} />
        <DriftSummary drift={summary.drift} />
      </section>

      <section>
        <MonitoringPanel />
      </section>
    </div>
  );
}
