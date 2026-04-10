import React from 'react';
import { useApi } from '../../hooks/useApi';
import { getCoverage, getMappingSummary } from '../../lib/api';
import { Library, Layers, FileEdit, GitCompareArrows } from 'lucide-react';
import CoverageCard from './CoverageCard';
import GapSummary from './GapSummary';
import RecentActivity from './RecentActivity';
import FrameworkGrid from './FrameworkGrid';

interface DashboardProps { scope: string; }

const ACCENT_COLORS = [
  '#818cf8', '#22d3ee', '#a78bfa', '#f472b6', '#fb923c',
  '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#f87171',
];

export default function Dashboard({ scope }: DashboardProps) {
  const { data: coverage, loading } = useApi(() => getCoverage(scope || undefined), [scope]);
  const { data: mappingSummary } = useApi(() => getMappingSummary(), []);

  const sortedCoverage = coverage
    ? [...coverage].sort((a, b) => {
        const aI = a.implemented > 0 || a.notApplicable > 0 ? 1 : 0;
        const bI = b.implemented > 0 || b.notApplicable > 0 ? 1 : 0;
        if (bI !== aI) return bI - aI;
        return b.totalControls - a.totalControls;
      })
    : [];

  const totalFw = coverage?.length ?? 0;
  const totalCtl = coverage?.reduce((s: number, c: any) => s + c.totalControls, 0) ?? 0;
  const totalImpl = coverage?.reduce((s: number, c: any) => s + c.implemented, 0) ?? 0;
  const totalMap = mappingSummary?.total ?? 0;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto space-y-8">
      <h2 className="sr-only">Dashboard</h2>

      {/* Quick stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Quick stats">
        {[
          { label: 'Frameworks', value: totalFw, icon: Library, glow: 'var(--glow-indigo)' },
          { label: 'Controls', value: totalCtl, icon: Layers, glow: 'var(--glow-blue)' },
          { label: 'Implemented', value: totalImpl, icon: FileEdit, glow: 'var(--glow-green)' },
          { label: 'Mappings', value: totalMap, icon: GitCompareArrows, glow: 'var(--glow-indigo)' },
        ].map(({ label, value, icon: Icon, glow }) => (
          <div key={label} className="glass-static px-5 py-4 flex items-center gap-3.5 rounded-2xl">
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--bg-glass-strong)', boxShadow: glow }}>
              <Icon className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>{value.toLocaleString()}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{label}</p>
            </div>
          </div>
        ))}
      </section>

      {/* Coverage cards */}
      <section aria-label="Framework coverage">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-dim)' }}>Framework Coverage</h3>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-static rounded-2xl p-5 h-48 animate-pulse" />
            ))}
          </div>
        ) : sortedCoverage.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedCoverage.map((c: any, i: number) => (
              <CoverageCard key={c.catalogShortName} shortName={c.catalogShortName} name={c.catalogName}
                totalControls={c.totalControls} implemented={c.implemented} notApplicable={c.notApplicable}
                mappedCoverage={c.mappedCoverage} coveragePct={c.coveragePct} effectivePct={c.effectivePct}
                accentColor={ACCENT_COLORS[i % ACCENT_COLORS.length]} index={i} />
            ))}
          </div>
        ) : (
          <div className="glass-static rounded-2xl p-10 text-center">
            <Library className="h-8 w-8 mx-auto mb-3 text-indigo-400/30" aria-hidden="true" />
            <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>No catalogs imported yet</p>
            <code className="text-[11px] mt-2 block font-mono" style={{ color: 'var(--text-dim)' }}>attesting catalog import --format oscal --file ...</code>
          </div>
        )}
      </section>

      {/* Gap + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section aria-label="Gap summary">{coverage && <GapSummary coverageData={coverage} />}</section>
        <section aria-label="Recent activity"><RecentActivity /></section>
      </div>

      {/* Heat map */}
      {coverage && coverage.length > 0 && (
        <section aria-label="Coverage heat map"><FrameworkGrid data={coverage} /></section>
      )}
    </div>
  );
}
