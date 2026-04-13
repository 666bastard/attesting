import React, { useState } from 'react';
import { FileCheck, Clock, AlertTriangle, XCircle, Archive, CheckCircle2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import {
  listEvidence,
  getEvidenceFreshness,
  transitionEvidence,
  type EvidenceRow,
  type EvidenceAction,
  type EvidenceStatus,
} from '../../lib/api';

const STATUS_FILTERS: Array<{ label: string; value: EvidenceStatus | '' }> = [
  { label: 'All',       value: '' },
  { label: 'Draft',     value: 'draft' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Reviewed',  value: 'reviewed' },
  { label: 'Accepted',  value: 'accepted' },
  { label: 'Expiring',  value: 'expiring' },
  { label: 'Expired',   value: 'expired' },
  { label: 'Rejected',  value: 'rejected' },
  { label: 'Archived',  value: 'archived' },
];

const ACTIONS_BY_STATUS: Record<EvidenceStatus, EvidenceAction[]> = {
  draft:     ['submit', 'archive'],
  submitted: ['review', 'archive'],
  reviewed:  ['accept', 'reject', 'archive'],
  rejected:  ['revise', 'archive'],
  accepted:  ['renew', 'archive'],
  expiring:  ['accept', 'renew', 'archive'],
  expired:   ['renew', 'archive'],
  archived:  [],
};

export default function EvidencePage() {
  const [statusFilter, setStatusFilter] = useState<EvidenceStatus | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: freshness } = useApi(() => getEvidenceFreshness(), []);
  const { data: items, loading, refetch } = useApi(
    () => listEvidence({ status: statusFilter || undefined }),
    [statusFilter],
  );

  const selectedItem = items?.find((it) => it.id === selected) ?? null;

  async function handleAction(id: string, action: EvidenceAction) {
    const reviewer = (action === 'review' || action === 'accept' || action === 'reject')
      ? window.prompt('Reviewer ID (required)') ?? undefined
      : undefined;
    if ((action === 'review' || action === 'accept' || action === 'reject') && !reviewer) return;
    const notes = window.prompt('Notes (optional)') ?? undefined;
    try {
      await transitionEvidence(id, { action, reviewer_id: reviewer, notes });
      refetch();
    } catch (err: any) {
      alert(`Transition failed: ${err.message}`);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      <header>
        <h2 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Evidence Lifecycle
        </h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
          Track, review, and renew evidence artifacts through their full lifecycle.
        </p>
      </header>

      {freshness && (
        <section className="grid grid-cols-2 md:grid-cols-6 gap-3" aria-label="Freshness summary">
          <FreshnessTile label="Fresh"         value={freshness.overall.fresh}         icon={FileCheck}     color="#4ade80" />
          <FreshnessTile label="Expiring"      value={freshness.overall.expiring_soon} icon={Clock}         color="#fbbf24" />
          <FreshnessTile label="Expired"       value={freshness.overall.expired}       icon={AlertTriangle} color="#fb7185" />
          <FreshnessTile label="Pending"       value={freshness.overall.pending}       icon={Clock}         color="#818cf8" />
          <FreshnessTile label="Rejected"      value={freshness.overall.rejected}      icon={XCircle}       color="#fb923c" />
          <FreshnessTile label="Archived"      value={freshness.overall.archived}      icon={Archive}       color="#6b7280" />
        </section>
      )}

      <section className="flex gap-1.5 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            onClick={() => setStatusFilter(f.value)}
            className="px-2.5 py-1 rounded-lg text-[11px] transition"
            style={{
              background: statusFilter === f.value ? 'var(--bg-glass-strong)' : 'transparent',
              color: statusFilter === f.value ? 'var(--text-primary)' : 'var(--text-dim)',
              border: `1px solid ${statusFilter === f.value ? 'var(--border-accent)' : 'var(--border-subtle)'}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </section>

      <section className="glass-static rounded-2xl overflow-hidden">
        {loading && !items ? (
          <div className="p-8 text-center">
            <div className="h-5 w-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : !items || items.length === 0 ? (
          <p className="p-8 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            No evidence matches the selected filter.
          </p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="text-left px-4 py-2 font-medium uppercase text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>Title</th>
                <th className="text-left px-3 py-2 font-medium uppercase text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>Status</th>
                <th className="text-left px-3 py-2 font-medium uppercase text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>Freshness</th>
                <th className="text-left px-3 py-2 font-medium uppercase text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>Valid until</th>
                <th className="text-left px-3 py-2 font-medium uppercase text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>v</th>
                <th className="text-right px-4 py-2 font-medium uppercase text-[10px] tracking-wider" style={{ color: 'var(--text-dim)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ev) => (
                <EvidenceRowView
                  key={ev.id}
                  ev={ev}
                  selected={selected === ev.id}
                  onSelect={() => setSelected(ev.id === selected ? null : ev.id)}
                  onAction={(action) => handleAction(ev.id, action)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedItem && (
        <section className="glass-static rounded-2xl p-5">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-dim)' }}>
            {selectedItem.title}
          </h3>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
            <DetailCell label="Status"        value={selectedItem.status} />
            <DetailCell label="Version"       value={String(selectedItem.version)} />
            <DetailCell label="Reviewer"      value={selectedItem.reviewer_id ?? '—'} />
            <DetailCell label="Renewal"       value={selectedItem.renewal_period_days ? `${selectedItem.renewal_period_days} days` : '—'} />
            <DetailCell label="Collected"     value={selectedItem.collected_at ?? '—'} />
            <DetailCell label="Valid from"    value={selectedItem.valid_from ?? '—'} />
            <DetailCell label="Valid until"   value={selectedItem.valid_until ?? '—'} />
            <DetailCell label="Last change"   value={selectedItem.last_state_change_at ?? '—'} />
          </dl>
          {selectedItem.review_notes && (
            <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
              Review notes: {selectedItem.review_notes}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function FreshnessTile({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div
      className="glass-static rounded-xl px-4 py-3"
      style={{ boxShadow: value > 0 ? `inset 0 0 0 1px ${color}44` : undefined }}
    >
      <div className="flex items-center justify-between mb-1">
        <Icon className="h-3.5 w-3.5" style={{ color }} aria-hidden="true" />
        <span className="text-xl font-semibold tabular-nums" style={{ color: value > 0 ? color : 'var(--text-primary)' }}>
          {value}
        </span>
      </div>
      <p className="text-[10px] uppercase" style={{ color: 'var(--text-dim)' }}>{label}</p>
    </div>
  );
}

function EvidenceRowView({
  ev, selected, onSelect, onAction,
}: {
  ev: EvidenceRow;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: EvidenceAction) => void;
}) {
  const actions = ACTIONS_BY_STATUS[ev.status] ?? [];
  return (
    <tr
      className="transition cursor-pointer"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: selected ? 'var(--bg-glass-strong)' : undefined,
      }}
      onClick={onSelect}
    >
      <td className="px-4 py-2 truncate max-w-[320px]" style={{ color: 'var(--text-primary)' }}>{ev.title}</td>
      <td className="px-3 py-2"><StatusBadge status={ev.status} /></td>
      <td className="px-3 py-2"><FreshnessBadge freshness={ev.freshness} /></td>
      <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>{ev.valid_until?.substring(0, 10) ?? '—'}</td>
      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--text-dim)' }}>v{ev.version}</td>
      <td className="px-4 py-2 text-right space-x-1">
        {actions.map((a) => (
          <button
            key={a}
            onClick={(e) => { e.stopPropagation(); onAction(a); }}
            className="text-[10px] px-2 py-0.5 rounded border transition hover:bg-white/5"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
          >
            {a}
          </button>
        ))}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: EvidenceStatus }) {
  const colors: Record<EvidenceStatus, string> = {
    draft: '#6b7280', submitted: '#818cf8', reviewed: '#a78bfa',
    accepted: '#4ade80', rejected: '#fb7185', expiring: '#fbbf24',
    expired: '#fb7185', archived: '#6b7280',
  };
  return (
    <span
      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{
        background: `${colors[status]}22`,
        color: colors[status],
        border: `1px solid ${colors[status]}66`,
      }}
    >
      {status}
    </span>
  );
}

function FreshnessBadge({ freshness }: { freshness?: string }) {
  if (!freshness) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  const map: Record<string, { color: string; icon: any }> = {
    fresh:         { color: '#4ade80', icon: CheckCircle2 },
    expiring_soon: { color: '#fbbf24', icon: Clock },
    expired:       { color: '#fb7185', icon: AlertTriangle },
    pending:       { color: '#818cf8', icon: Clock },
    rejected:      { color: '#fb923c', icon: XCircle },
    archived:      { color: '#6b7280', icon: Archive },
  };
  const { color, icon: Icon } = map[freshness] ?? map.pending;
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color }}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {freshness.replace('_', ' ')}
    </span>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</dt>
      <dd className="mt-0.5 font-mono" style={{ color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  );
}
