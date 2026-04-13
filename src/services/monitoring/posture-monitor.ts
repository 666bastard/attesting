import type Database from 'better-sqlite3';
import { createDriftAlert } from '../drift/alert-writer.js';
import { resolveThresholds } from './thresholds.js';
import type {
  PostureFinding,
  PostureMonitorResult,
  MonitorSeverity,
  MonitoringThresholds,
} from '../../models/monitoring.js';

/**
 * Phase 8D Posture Monitor.
 *
 * Walks every persisted compliance_scores row, resolves the applicable
 * thresholds, and generates drift alerts (alert_type='posture_change')
 * for three conditions:
 *
 *   1. Threshold breach  — latest score fell below warning or critical line.
 *   2. Delta breach      — latest score dropped N+ points vs previous snapshot.
 *   3. Trend breach      — score decreased in each of the last `trend_window`
 *                          consecutive snapshots.
 *
 * Alerts are deduplicated by createDriftAlert() keyed on (alert_type,
 * source_entity_type, source_entity_id), so repeat runs don't spam.
 * We use source_entity_type='compliance_score' with source_entity_id
 * equal to the latest snapshot row id so each new snapshot can raise a
 * fresh alert rather than piling onto a stale one.
 */

interface SnapshotRow {
  id: string;
  scope_id: string | null;
  catalog_id: string;
  overall_score: number;
  calculated_at: string;
}

interface HistoryRow {
  overall_score: number;
  calculated_at: string;
}

export function runPostureMonitor(db: Database.Database): PostureMonitorResult {
  const snapshots = db
    .prepare(`
      SELECT cs.id, cs.scope_id, cs.catalog_id, cs.overall_score, cs.calculated_at,
             cat.short_name AS catalog_short_name
      FROM compliance_scores cs
      JOIN catalogs cat ON cs.catalog_id = cat.id
      ORDER BY cs.catalog_id, cs.scope_id
    `)
    .all() as Array<SnapshotRow & { catalog_short_name: string }>;

  const findings: PostureFinding[] = [];
  let alertsCreated = 0;

  for (const snap of snapshots) {
    const thresholds = resolveThresholds(db, snap.scope_id, snap.catalog_id);
    if (!thresholds.enabled) continue;

    const history = loadHistory(db, snap.catalog_id, snap.scope_id, thresholds.trend_window + 1);
    const finding = evaluate(snap, history, thresholds);

    if (finding.threshold_breached || finding.delta_breached || finding.trend_breached) {
      const alertIds = raiseAlerts(db, snap, finding);
      finding.alert_ids = alertIds;
      alertsCreated += alertIds.length;
    }

    findings.push(finding);
  }

  return {
    checked_at: new Date().toISOString(),
    checked: snapshots.length,
    findings,
    alerts_created: alertsCreated,
  };
}

// ── Pure evaluation (exported for tests) ────────────────────

export function evaluate(
  snap: SnapshotRow & { catalog_short_name: string },
  history: HistoryRow[],
  thresholds: MonitoringThresholds,
): PostureFinding {
  const current = snap.overall_score;
  const previous = history.length >= 2 ? history[1].overall_score : null;
  const delta = previous !== null ? previous - current : null;

  // Threshold breach
  let thresholdBreached = false;
  let thresholdKind: 'critical' | 'warning' | null = null;
  let thresholdSeverity: MonitorSeverity | null = null;
  if (current < thresholds.critical_threshold) {
    thresholdBreached = true;
    thresholdKind = 'critical';
    thresholdSeverity = 'critical';
  } else if (current < thresholds.warning_threshold) {
    thresholdBreached = true;
    thresholdKind = 'warning';
    thresholdSeverity = 'high';
  }

  // Delta breach
  let deltaBreached = false;
  let deltaSeverity: MonitorSeverity | null = null;
  if (delta !== null && delta > 0) {
    if (delta >= thresholds.delta_critical) {
      deltaBreached = true;
      deltaSeverity = 'critical';
    } else if (delta >= thresholds.delta_warning) {
      deltaBreached = true;
      deltaSeverity = 'high';
    }
  }

  // Trend breach — consecutive drops across the window
  const consecutiveDrops = countConsecutiveDrops(history);
  const trendBreached = consecutiveDrops >= thresholds.trend_window;

  return {
    scope_id: snap.scope_id,
    catalog_id: snap.catalog_id,
    catalog_short_name: snap.catalog_short_name,
    current_score: current,
    previous_score: previous,
    threshold_breached: thresholdBreached,
    threshold_severity: thresholdSeverity,
    threshold_kind: thresholdKind,
    delta,
    delta_breached: deltaBreached,
    delta_severity: deltaSeverity,
    consecutive_drops: consecutiveDrops,
    trend_breached: trendBreached,
    alert_ids: [],
  };
}

/**
 * Count how many consecutive snapshots (walking backwards from newest)
 * showed a score decrease vs the one immediately preceding. history[0] is
 * the most recent snapshot.
 */
export function countConsecutiveDrops(history: HistoryRow[]): number {
  let drops = 0;
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].overall_score < history[i + 1].overall_score) {
      drops++;
    } else {
      break;
    }
  }
  return drops;
}

// ── Alert writers ──────────────────────────────────────────

function raiseAlerts(
  db: Database.Database,
  snap: SnapshotRow & { catalog_short_name: string },
  finding: PostureFinding,
): string[] {
  const ids: string[] = [];

  if (finding.threshold_breached && finding.threshold_severity) {
    ids.push(
      createDriftAlert(db, {
        alert_type: 'posture_change',
        severity: finding.threshold_severity,
        title: `Compliance score below ${finding.threshold_kind} threshold: ${snap.catalog_short_name}`,
        message: `${snap.catalog_short_name} scored ${finding.current_score.toFixed(1)} in ${scopeLabel(snap.scope_id)} — below the configured threshold.`,
        source_entity_type: 'compliance_score',
        source_entity_id: `${snap.id}:threshold`,
      }),
    );
  }

  if (finding.delta_breached && finding.delta_severity && finding.delta !== null) {
    ids.push(
      createDriftAlert(db, {
        alert_type: 'posture_change',
        severity: finding.delta_severity,
        title: `Compliance score dropped ${finding.delta.toFixed(1)} points: ${snap.catalog_short_name}`,
        message: `${snap.catalog_short_name} fell from ${finding.previous_score?.toFixed(1)} to ${finding.current_score.toFixed(1)} in ${scopeLabel(snap.scope_id)}.`,
        source_entity_type: 'compliance_score',
        source_entity_id: `${snap.id}:delta`,
      }),
    );
  }

  if (finding.trend_breached) {
    ids.push(
      createDriftAlert(db, {
        alert_type: 'posture_change',
        severity: 'high',
        title: `Sustained decline (${finding.consecutive_drops} snapshots): ${snap.catalog_short_name}`,
        message: `${snap.catalog_short_name} has declined for ${finding.consecutive_drops} consecutive snapshots in ${scopeLabel(snap.scope_id)}.`,
        source_entity_type: 'compliance_score',
        source_entity_id: `${snap.id}:trend`,
      }),
    );
  }

  return ids;
}

function loadHistory(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null,
  limit: number,
): HistoryRow[] {
  return db.prepare(`
    SELECT overall_score, calculated_at
    FROM compliance_score_history
    WHERE catalog_id = ?
      AND ${scopeId === null ? 'scope_id IS NULL' : 'scope_id = ?'}
    ORDER BY calculated_at DESC, rowid DESC
    LIMIT ?
  `).all(
    ...(scopeId === null ? [catalogId, limit] : [catalogId, scopeId, limit]),
  ) as HistoryRow[];
}

function scopeLabel(scopeId: string | null): string {
  return scopeId ? `scope ${scopeId}` : 'org-wide';
}
