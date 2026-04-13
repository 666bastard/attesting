import type Database from 'better-sqlite3';
import { calculateScore } from '../scoring/compliance-score.js';
import { getLatestScore, getScoreHistory } from '../scoring/snapshot.js';
import { getFreshnessSummary } from '../evidence/freshness.js';
import type { ComplianceScore, FamilyBreakdown } from '../../models/compliance-score.js';

/**
 * Phase 8C — Audit Report data aggregator.
 *
 * Collects every piece of evidence an audit report needs in a single pass
 * so PDF/DOCX generators just format a structured object. Pure read layer
 * — no writes, no propagation.
 */

export interface ReportScope {
  id: string | null;
  name: string;
}

export interface ReportCatalog {
  id: string;
  short_name: string;
  name: string;
  total_controls: number;
}

export interface ReportOrganization {
  id: string | null;
  name: string;
}

export interface ReportControlRow {
  control_id: string;          // native id (e.g. AC-2)
  title: string;
  family: string;
  impl_status: string | null;
  impl_statement: string | null;
  evidence_count: number;
  evidence_fresh: number;
  evidence_expired: number;
  latest_evidence_at: string | null;
  assessment_result: string | null;
}

export interface ReportRisk {
  risk_id: string;
  title: string;
  category: string | null;
  likelihood: number;
  impact: number;
  inherent_risk_score: number;
  residual_risk_score: number | null;
  owner: string;
  status: string;
  treatment: string | null;
}

export interface ReportPoamItem {
  poam_id: string;
  control_native_id: string;
  priority: string;
  finding: string;
  target_date: string | null;
  status: string;
  overdue: boolean;
}

export interface ReportTrendPoint {
  calculated_at: string;
  overall_score: number;
}

export interface ReportData {
  generated_at: string;
  organization: ReportOrganization;
  scope: ReportScope;
  catalog: ReportCatalog;
  score: ComplianceScore | null;
  score_fresh: boolean;
  family_breakdown: FamilyBreakdown[];
  trend: ReportTrendPoint[];
  controls: ReportControlRow[];
  evidence_summary: {
    total: number;
    fresh: number;
    expiring_soon: number;
    expired: number;
    pending: number;
    rejected: number;
    archived: number;
    controls_with_evidence: number;
    controls_missing_evidence: number;
  };
  risks: {
    total_open: number;
    by_severity: Array<{ severity: string; count: number }>;
    top: ReportRisk[];
  };
  poam: {
    total_open: number;
    overdue: number;
    items: ReportPoamItem[];
  };
  monitoring: {
    active_drift_alerts: number;
    posture_change_alerts: number;
  };
  methodology: {
    coverage_weight: number;
    evidence_weight: number;
    assessment_weight: number;
    evidence_fresh_days: number;
  };
}

export interface AggregateOptions {
  scope_id?: string | null;
  catalog_id: string;
  trend_days?: number;
}

export function aggregateReportData(
  db: Database.Database,
  options: AggregateOptions,
): ReportData {
  const scopeId = options.scope_id ?? null;
  const catalogId = options.catalog_id;
  const trendDays = options.trend_days ?? 90;

  const organization = loadOrganization(db);
  const scope = loadScope(db, scopeId);
  const catalog = loadCatalog(db, catalogId);

  const persisted = getLatestScore(db, catalogId, scopeId);
  const computed = persisted ?? ({
    id: 'computed',
    calculated_at: new Date().toISOString(),
    ...calculateScore(db, catalogId, scopeId),
  } as ComplianceScore);

  const trendEntries = getScoreHistory(db, catalogId, scopeId, trendDays);
  const trend: ReportTrendPoint[] = trendEntries.map((e) => ({
    calculated_at: e.calculated_at,
    overall_score: e.overall_score,
  }));

  const controls = loadControls(db, catalogId, scopeId);
  const evidenceSummary = summarizeEvidence(db, catalogId, scopeId);
  const risks = loadRisks(db);
  const poam = loadPoam(db);
  const monitoring = loadMonitoring(db);

  return {
    generated_at: new Date().toISOString(),
    organization,
    scope,
    catalog,
    score: computed,
    score_fresh: !!persisted,
    family_breakdown: computed.family_breakdown ?? [],
    trend,
    controls,
    evidence_summary: evidenceSummary,
    risks,
    poam,
    monitoring,
    methodology: {
      coverage_weight: computed.coverage_weight ?? 0.5,
      evidence_weight: computed.evidence_weight ?? 0.3,
      assessment_weight: computed.assessment_weight ?? 0.2,
      evidence_fresh_days: 365,
    },
  };
}

// ── loaders ───────────────────────────────────────────────

function loadOrganization(db: Database.Database): ReportOrganization {
  const row = db.prepare('SELECT id, name FROM organizations LIMIT 1').get() as
    | { id: string; name: string } | undefined;
  return { id: row?.id ?? null, name: row?.name ?? 'Unknown Organization' };
}

function loadScope(db: Database.Database, scopeId: string | null): ReportScope {
  if (!scopeId) return { id: null, name: 'Organization-wide' };
  const row = db.prepare('SELECT id, name FROM scopes WHERE id = ?').get(scopeId) as
    | { id: string; name: string } | undefined;
  return row ? { id: row.id, name: row.name } : { id: scopeId, name: scopeId };
}

function loadCatalog(db: Database.Database, catalogId: string): ReportCatalog {
  const row = db
    .prepare('SELECT id, short_name, name, COALESCE(total_controls, 0) AS total_controls FROM catalogs WHERE id = ?')
    .get(catalogId) as { id: string; short_name: string; name: string; total_controls: number } | undefined;
  if (!row) throw new Error(`Catalog not found: ${catalogId}`);
  return row;
}

function loadControls(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null,
): ReportControlRow[] {
  const scopeClause = scopeId ? `AND (i.scope_id = ? OR i.scope_id IS NULL)` : '';
  const params: unknown[] = scopeId ? [scopeId, catalogId] : [catalogId];

  const rows = db.prepare(`
    SELECT
      c.id AS control_uuid,
      c.control_id,
      c.title,
      COALESCE(c.family, SUBSTR(c.control_id, 1, 2)) AS family,
      (SELECT i.status FROM implementations i
         WHERE i.primary_control_id = c.id ${scopeClause}
         ORDER BY i.updated_at DESC LIMIT 1) AS impl_status,
      (SELECT i.statement FROM implementations i
         WHERE i.primary_control_id = c.id ${scopeClause}
         ORDER BY i.updated_at DESC LIMIT 1) AS impl_statement,
      (SELECT COUNT(*) FROM evidence e
         JOIN implementations i ON e.implementation_id = i.id
         WHERE i.primary_control_id = c.id) AS evidence_count,
      (SELECT COUNT(*) FROM evidence e
         JOIN implementations i ON e.implementation_id = i.id
         WHERE i.primary_control_id = c.id AND e.status = 'accepted') AS evidence_fresh,
      (SELECT COUNT(*) FROM evidence e
         JOIN implementations i ON e.implementation_id = i.id
         WHERE i.primary_control_id = c.id AND e.status = 'expired') AS evidence_expired,
      (SELECT MAX(COALESCE(e.collected_at, e.created_at)) FROM evidence e
         JOIN implementations i ON e.implementation_id = i.id
         WHERE i.primary_control_id = c.id) AS latest_evidence_at,
      (SELECT ar.result FROM assessment_results ar
         JOIN assessments a ON ar.assessment_id = a.id
         WHERE ar.control_id = c.id AND a.catalog_id = ?
         ORDER BY ar.assessed_at DESC LIMIT 1) AS assessment_result
    FROM controls c
    WHERE c.catalog_id = ?
    ORDER BY family, c.sort_order, c.control_id
  `).all(...(scopeId
    ? [scopeId, scopeId, catalogId, catalogId]
    : [catalogId, catalogId])) as any[];

  return rows.map((r) => ({
    control_id: r.control_id,
    title: r.title,
    family: r.family ?? '',
    impl_status: r.impl_status ?? null,
    impl_statement: r.impl_statement ?? null,
    evidence_count: r.evidence_count ?? 0,
    evidence_fresh: r.evidence_fresh ?? 0,
    evidence_expired: r.evidence_expired ?? 0,
    latest_evidence_at: r.latest_evidence_at ?? null,
    assessment_result: r.assessment_result ?? null,
  }));
}

function summarizeEvidence(
  db: Database.Database,
  catalogId: string,
  _scopeId: string | null,
): ReportData['evidence_summary'] {
  const summary = getFreshnessSummary(db);
  const forCatalog = summary.by_catalog.find((c) => c.catalog_id === catalogId);
  if (!forCatalog) {
    return {
      total: 0, fresh: 0, expiring_soon: 0, expired: 0, pending: 0,
      rejected: 0, archived: 0, controls_with_evidence: 0, controls_missing_evidence: 0,
    };
  }
  return {
    total: forCatalog.total,
    fresh: forCatalog.fresh,
    expiring_soon: forCatalog.expiring_soon,
    expired: forCatalog.expired,
    pending: forCatalog.pending,
    rejected: forCatalog.rejected,
    archived: forCatalog.archived,
    controls_with_evidence: forCatalog.controls_with_evidence,
    controls_missing_evidence: forCatalog.controls_missing_evidence,
  };
}

function loadRisks(db: Database.Database): ReportData['risks'] {
  if (!tableExists(db, 'risks')) {
    return { total_open: 0, by_severity: [], top: [] };
  }
  const totalOpen = (db.prepare(`SELECT COUNT(*) AS c FROM risks WHERE status != 'closed'`).get() as { c: number }).c;
  const bySeverity = db.prepare(`
    SELECT
      CASE
        WHEN inherent_risk_score >= 20 THEN 'critical'
        WHEN inherent_risk_score >= 15 THEN 'high'
        WHEN inherent_risk_score >= 9  THEN 'medium'
        WHEN inherent_risk_score >= 4  THEN 'low'
        ELSE 'info'
      END AS severity,
      COUNT(*) AS count
    FROM risks WHERE status != 'closed'
    GROUP BY severity
  `).all() as Array<{ severity: string; count: number }>;
  const top = db.prepare(`
    SELECT risk_id, title, category, likelihood, impact, inherent_risk_score,
           residual_risk_score, owner, status, treatment
    FROM risks WHERE status != 'closed'
    ORDER BY inherent_risk_score DESC LIMIT 10
  `).all() as ReportRisk[];
  return { total_open: totalOpen, by_severity: bySeverity, top };
}

function loadPoam(db: Database.Database): ReportData['poam'] {
  if (!tableExists(db, 'poam_items')) return { total_open: 0, overdue: 0, items: [] };
  const items = db.prepare(`
    SELECT p.poam_id, c.control_id AS control_native_id, p.priority,
           p.finding, p.target_date, p.status
    FROM poam_items p
    JOIN controls c ON p.control_id = c.id
    WHERE p.status NOT IN ('completed', 'deferred')
    ORDER BY CASE p.priority
      WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      p.target_date
  `).all() as Array<Omit<ReportPoamItem, 'overdue'>>;
  const today = new Date().toISOString().slice(0, 10);
  const enriched: ReportPoamItem[] = items.map((i) => ({
    ...i,
    overdue: !!(i.target_date && i.target_date < today),
  }));
  return {
    total_open: enriched.length,
    overdue: enriched.filter((i) => i.overdue).length,
    items: enriched,
  };
}

function loadMonitoring(db: Database.Database): ReportData['monitoring'] {
  if (!tableExists(db, 'drift_alerts')) {
    return { active_drift_alerts: 0, posture_change_alerts: 0 };
  }
  const active = (db.prepare(
    `SELECT COUNT(*) AS c FROM drift_alerts WHERE resolved_at IS NULL`,
  ).get() as { c: number }).c;
  const posture = (db.prepare(
    `SELECT COUNT(*) AS c FROM drift_alerts WHERE alert_type = 'posture_change' AND resolved_at IS NULL`,
  ).get() as { c: number }).c;
  return { active_drift_alerts: active, posture_change_alerts: posture };
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
}
