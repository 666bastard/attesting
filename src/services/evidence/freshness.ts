import type Database from 'better-sqlite3';
import { createDriftAlert } from '../drift/alert-writer.js';
import { systemTransition } from './lifecycle.js';
import { DEFAULT_EXPIRY_LEAD_DAYS } from '../../models/evidence.js';

/**
 * Phase 8E — evidence expiry sweep + freshness reporting.
 *
 * `sweepExpiry` is called by the drift scheduler. It:
 *   1. Transitions accepted → expiring when valid_until is within the
 *      lead window (default 30 days).
 *   2. Transitions accepted/expiring → expired when valid_until has passed.
 *   3. Generates drift alerts for each transition.
 *
 * `getFreshnessSummary` returns per-catalog counts used by the dashboard
 * and the Evidence Package audit report.
 */

export interface SweepResult {
  checked: number;
  transitioned_expiring: number;
  transitioned_expired: number;
  alerts_created: number;
}

export function sweepExpiry(
  db: Database.Database,
  leadDays = DEFAULT_EXPIRY_LEAD_DAYS,
): SweepResult {
  const nowTs = Date.now();
  const leadCutoff = new Date(nowTs + leadDays * 86400_000).toISOString();
  const nowIso = new Date(nowTs).toISOString();

  // Accepted with valid_until in the past → expired
  const pastDueAccepted = db.prepare(`
    SELECT id, title, valid_until FROM evidence
    WHERE status IN ('accepted', 'expiring')
      AND valid_until IS NOT NULL
      AND valid_until < ?
  `).all(nowIso) as Array<{ id: string; title: string; valid_until: string }>;

  // Accepted but expiring soon
  const expiringSoon = db.prepare(`
    SELECT id, title, valid_until FROM evidence
    WHERE status = 'accepted'
      AND valid_until IS NOT NULL
      AND valid_until >= ?
      AND valid_until <= ?
  `).all(nowIso, leadCutoff) as Array<{ id: string; title: string; valid_until: string }>;

  let alerts = 0;

  for (const ev of pastDueAccepted) {
    systemTransition(db, ev.id, 'expired', `valid_until passed on ${ev.valid_until}`);
    createDriftAlert(db, {
      alert_type: 'evidence_expired',
      severity: 'high',
      title: `Evidence expired: ${ev.title}`,
      message: `Validity window ended on ${ev.valid_until}. Renewal required.`,
      source_entity_type: 'evidence',
      source_entity_id: ev.id,
    });
    alerts++;
  }

  for (const ev of expiringSoon) {
    systemTransition(db, ev.id, 'expiring', `valid_until within ${leadDays}-day lead window`);
    createDriftAlert(db, {
      alert_type: 'evidence_expired',
      severity: 'medium',
      title: `Evidence expiring soon: ${ev.title}`,
      message: `Validity ends on ${ev.valid_until}. Renew within ${leadDays} days.`,
      source_entity_type: 'evidence',
      source_entity_id: ev.id,
    });
    alerts++;
  }

  return {
    checked: pastDueAccepted.length + expiringSoon.length,
    transitioned_expiring: expiringSoon.length,
    transitioned_expired: pastDueAccepted.length,
    alerts_created: alerts,
  };
}

// ── Freshness summary ──────────────────────────────────────

export interface FreshnessBucketCounts {
  fresh: number;
  expiring_soon: number;
  expired: number;
  pending: number;   // draft | submitted | reviewed
  rejected: number;
  archived: number;
}

export interface FreshnessByCatalog extends FreshnessBucketCounts {
  catalog_id: string;
  catalog_short_name: string;
  total: number;
  controls_with_evidence: number;
  controls_missing_evidence: number;
  total_controls: number;
}

export function getFreshnessSummary(
  db: Database.Database,
  leadDays = DEFAULT_EXPIRY_LEAD_DAYS,
): { overall: FreshnessBucketCounts; by_catalog: FreshnessByCatalog[]; generated_at: string } {
  const nowTs = Date.now();
  const leadCutoff = new Date(nowTs + leadDays * 86400_000).toISOString();
  const nowIso = new Date(nowTs).toISOString();

  const overall = bucketCount(db, `
    SELECT status, valid_until FROM evidence
  `, [], nowIso, leadCutoff);

  const catalogs = db.prepare(
    'SELECT id, short_name FROM catalogs ORDER BY short_name',
  ).all() as Array<{ id: string; short_name: string }>;

  const byCatalog: FreshnessByCatalog[] = catalogs.map((cat) => {
    const counts = bucketCount(db, `
      SELECT e.status, e.valid_until
      FROM evidence e
      JOIN implementations i ON e.implementation_id = i.id
      JOIN controls c ON i.primary_control_id = c.id
      WHERE c.catalog_id = ?
    `, [cat.id], nowIso, leadCutoff);

    const totalControls = (db.prepare('SELECT COUNT(*) AS c FROM controls WHERE catalog_id = ?').get(cat.id) as { c: number }).c;
    const withEvidence = (db.prepare(`
      SELECT COUNT(DISTINCT c.id) AS c
      FROM controls c
      JOIN implementations i ON i.primary_control_id = c.id
      JOIN evidence e ON e.implementation_id = i.id
      WHERE c.catalog_id = ?
        AND e.status NOT IN ('archived', 'rejected')
    `).get(cat.id) as { c: number }).c;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      catalog_id: cat.id,
      catalog_short_name: cat.short_name,
      ...counts,
      total,
      controls_with_evidence: withEvidence,
      controls_missing_evidence: Math.max(0, totalControls - withEvidence),
      total_controls: totalControls,
    };
  });

  return { overall, by_catalog: byCatalog, generated_at: new Date().toISOString() };
}

function bucketCount(
  db: Database.Database,
  baseSql: string,
  baseParams: unknown[],
  nowIso: string,
  leadCutoff: string,
): FreshnessBucketCounts {
  const rows = db.prepare(baseSql).all(...baseParams) as Array<{ status: string; valid_until: string | null }>;
  const counts: FreshnessBucketCounts = {
    fresh: 0, expiring_soon: 0, expired: 0, pending: 0, rejected: 0, archived: 0,
  };
  for (const r of rows) {
    if (r.status === 'archived') { counts.archived++; continue; }
    if (r.status === 'rejected') { counts.rejected++; continue; }
    if (r.status === 'expired') { counts.expired++; continue; }
    if (['draft', 'submitted', 'reviewed'].includes(r.status)) { counts.pending++; continue; }
    if (r.valid_until && r.valid_until < nowIso) { counts.expired++; continue; }
    if (r.valid_until && r.valid_until <= leadCutoff) { counts.expiring_soon++; continue; }
    counts.fresh++;
  }
  return counts;
}
