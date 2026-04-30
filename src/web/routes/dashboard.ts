import { Router } from 'express';
import type Database from 'better-sqlite3';
import { db } from '../../db/connection.js';
import {
  getScoresForScope,
  getScoreHistory,
  snapshotScore,
} from '../../services/scoring/snapshot.js';
import type { ComplianceScore } from '../../models/compliance-score.js';

/**
 * Phase 8B — Executive Dashboard aggregation.
 *
 * Single GET /api/dashboard/summary endpoint returns every KPI the
 * executive page renders in one request so the UI can avoid waterfall
 * fetches. Read-only; relies entirely on existing tables + 8A scoring.
 *
 * Query params:
 *   ?scope=<name|uuid|org>   filter widgets to a scope (default org-wide)
 *   ?catalog=<short|uuid>    when present, trend widget uses this catalog
 *   ?trendDays=<n>           history window (default 90)
 */
export function dashboardRoutes(): Router {
  const router = Router();

  router.get('/summary', (req, res) => {
    const database = db.getDb();
    const scopeRef = typeof req.query.scope === 'string' ? req.query.scope : undefined;
    const catalogRef = typeof req.query.catalog === 'string' ? req.query.catalog : undefined;
    const trendDays = parsePositiveInt(req.query.trendDays, 90);

    const scopeId = resolveScope(database, scopeRef);
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${scopeRef}" not found` });
      return;
    }

    const catalogId = catalogRef ? resolveCatalog(database, catalogRef) : null;
    if (catalogRef && !catalogId) {
      res.status(404).json({ error: `Catalog "${catalogRef}" not found` });
      return;
    }

    const compliance = buildCompliance(database, scopeId);
    const trend = buildTrend(database, scopeId, catalogId, trendDays);
    const coverage = buildCoverage(compliance.catalogs);
    const risk = buildRisk(database);
    const drift = buildDrift(database);
    const evidence = buildEvidence(database, scopeId);
    const poam = buildPoam(database);
    const frameworks = compliance.catalogs.map((c) => ({
      catalog_id: c.catalog_id,
      catalog_short_name: c.catalog_short_name,
      catalog_name: c.catalog_name,
      overall_score: c.overall_score,
      coverage_score: c.coverage_score,
      evidence_score: c.evidence_score,
      assessment_score: c.assessment_score,
      total_controls: c.total_controls,
      implemented_count: c.implemented_count,
    }));

    res.json({
      scope: { ref: scopeRef ?? 'org', id: scopeId },
      compliance: {
        overall_score: compliance.overall,
        catalog_count: compliance.catalogs.length,
        best_catalog: pickTop(frameworks, 'desc'),
        worst_catalog: pickTop(frameworks, 'asc'),
      },
      frameworks,
      trend,
      coverage,
      risk,
      drift,
      evidence,
      poam,
      generated_at: new Date().toISOString(),
    });
  });

  return router;
}

// ── Compliance aggregation ─────────────────────────────────

function buildCompliance(database: Database.Database, scopeId: string | null) {
  // Snapshot on demand if nothing persisted yet — gives first-time users
  // a useful dashboard without requiring a CLI call first.
  let catalogs = getScoresForScope(database, scopeId);
  if (catalogs.length === 0) {
    const rows = database.prepare('SELECT id FROM catalogs').all() as Array<{ id: string }>;
    for (const r of rows) snapshotScore(database, r.id, scopeId, { trigger: 'scheduled' });
    catalogs = getScoresForScope(database, scopeId);
  }

  const overall = catalogs.length > 0
    ? round2(catalogs.reduce((s, c) => s + c.overall_score, 0) / catalogs.length)
    : 0;
  return { overall, catalogs };
}

function buildTrend(
  database: Database.Database,
  scopeId: string | null,
  catalogId: string | null,
  trendDays: number,
): {
  catalog_id: string | null;
  since_days: number;
  points: Array<{ calculated_at: string; overall_score: number }>;
} {
  // If no catalog specified, pick the one with the most snapshots so the
  // executive sees a real line, not a flat-zero.
  let effectiveCatalog = catalogId;
  if (!effectiveCatalog) {
    const top = database.prepare(`
      SELECT catalog_id, COUNT(*) AS c FROM compliance_score_history
      WHERE ${scopeId ? 'scope_id = ?' : 'scope_id IS NULL'}
      GROUP BY catalog_id ORDER BY c DESC LIMIT 1
    `).get(...(scopeId ? [scopeId] : [])) as { catalog_id: string } | undefined;
    effectiveCatalog = top?.catalog_id ?? null;
  }

  if (!effectiveCatalog) {
    return { catalog_id: null, since_days: trendDays, points: [] };
  }

  const entries = getScoreHistory(database, effectiveCatalog, scopeId, trendDays);
  return {
    catalog_id: effectiveCatalog,
    since_days: trendDays,
    points: entries.map((e) => ({
      calculated_at: e.calculated_at,
      overall_score: e.overall_score,
    })),
  };
}

// ── Coverage / risk / drift / evidence / poam aggregators ──

function buildCoverage(catalogs: ComplianceScore[]) {
  const totals = {
    total_controls: 0,
    implemented: 0,
    partial: 0,
    planned: 0,
    alternative: 0,
    not_implemented: 0,
    not_applicable: 0,
  };
  for (const c of catalogs) {
    totals.total_controls += c.total_controls;
    totals.implemented += c.implemented_count;
    totals.partial += c.partial_count;
    totals.planned += c.planned_count;
    totals.alternative += c.alternative_count;
    totals.not_implemented += c.not_implemented_count;
    totals.not_applicable += c.not_applicable_count;
  }
  const effective = totals.total_controls - totals.not_applicable;
  const pct = effective > 0 ? round2((totals.implemented / effective) * 100) : 0;
  return { ...totals, effective_total: effective, implemented_pct: pct };
}

function buildRisk(database: Database.Database) {
  if (!tableExists(database, 'risks')) {
    return { total_open: 0, above_appetite: 0, by_severity: [], top: [] };
  }
  const total = (database.prepare(
    `SELECT COUNT(*) AS c FROM risks WHERE status != 'closed'`,
  ).get() as { c: number }).c;
  const above = (database.prepare(
    `SELECT COUNT(*) AS c FROM risks WHERE status != 'closed'
     AND inherent_risk_score > (SELECT appetite_threshold FROM risk_matrix LIMIT 1)`,
  ).get() as { c: number } | undefined)?.c ?? 0;

  const bySeverity = database.prepare(`
    SELECT
      CASE
        WHEN inherent_risk_score >= 20 THEN 'critical'
        WHEN inherent_risk_score >= 15 THEN 'high'
        WHEN inherent_risk_score >= 9  THEN 'medium'
        WHEN inherent_risk_score >= 4  THEN 'low'
        ELSE 'info'
      END AS severity,
      COUNT(*) AS count
    FROM risks
    WHERE status != 'closed'
    GROUP BY severity
  `).all() as Array<{ severity: string; count: number }>;

  const top = database.prepare(`
    SELECT risk_id, title, inherent_risk_score, residual_risk_score, owner, status
    FROM risks
    WHERE status != 'closed'
    ORDER BY inherent_risk_score DESC
    LIMIT 10
  `).all();

  return { total_open: total, above_appetite: above, by_severity: bySeverity, top };
}

function buildDrift(database: Database.Database) {
  if (!tableExists(database, 'drift_alerts')) {
    return { active: 0, by_severity: [], pending_dispositions: 0, recent: [] };
  }
  const active = (database.prepare(`
    SELECT COUNT(*) AS c FROM drift_alerts
    WHERE resolved_at IS NULL
      AND (suppressed_until IS NULL OR suppressed_until < datetime('now'))
  `).get() as { c: number }).c;

  const bySeverity = database.prepare(`
    SELECT severity, COUNT(*) AS count
    FROM drift_alerts
    WHERE resolved_at IS NULL
    GROUP BY severity
  `).all();

  const pending = tableExists(database, 'dispositions')
    ? (database.prepare(
        `SELECT COUNT(*) AS c FROM dispositions WHERE approval_status = 'pending'`,
      ).get() as { c: number }).c
    : 0;

  const recent = database.prepare(`
    SELECT id, alert_type, severity, title, created_at
    FROM drift_alerts
    WHERE resolved_at IS NULL
    ORDER BY created_at DESC
    LIMIT 5
  `).all();

  return { active, by_severity: bySeverity, pending_dispositions: pending, recent };
}

function buildEvidence(database: Database.Database, scopeId: string | null) {
  const scopeFilter = scopeId
    ? `AND (i.scope_id = ? OR i.scope_id IS NULL)`
    : '';
  const params: unknown[] = scopeId ? [scopeId] : [];

  const total = (database.prepare(
    `SELECT COUNT(*) AS c FROM evidence e
     JOIN implementations i ON e.implementation_id = i.id
     WHERE 1=1 ${scopeFilter}`,
  ).get(...params) as { c: number }).c;

  const fresh = (database.prepare(
    `SELECT COUNT(*) AS c FROM evidence e
     JOIN implementations i ON e.implementation_id = i.id
     WHERE (e.collected_at IS NOT NULL AND e.collected_at >= date('now','-365 days'))
       ${scopeFilter}`,
  ).get(...params) as { c: number }).c;

  const expiringSoon = (database.prepare(
    `SELECT COUNT(*) AS c FROM evidence e
     JOIN implementations i ON e.implementation_id = i.id
     WHERE e.collected_at IS NOT NULL
       AND e.collected_at < date('now','-335 days')
       AND e.collected_at >= date('now','-365 days')
       ${scopeFilter}`,
  ).get(...params) as { c: number }).c;

  return {
    total,
    fresh,
    expiring_soon: expiringSoon,
    stale: total - fresh,
    fresh_pct: total > 0 ? round2((fresh / total) * 100) : 0,
  };
}

function buildPoam(database: Database.Database) {
  if (!tableExists(database, 'poam_items')) {
    return { total_open: 0, by_priority: [], overdue: 0 };
  }
  const totalOpen = (database.prepare(
    `SELECT COUNT(*) AS c FROM poam_items WHERE status NOT IN ('completed','deferred')`,
  ).get() as { c: number }).c;

  const byPriority = database.prepare(`
    SELECT priority, COUNT(*) AS count FROM poam_items
    WHERE status NOT IN ('completed','deferred')
    GROUP BY priority
  `).all();

  const overdue = (database.prepare(
    `SELECT COUNT(*) AS c FROM poam_items
     WHERE status NOT IN ('completed','deferred')
       AND target_date IS NOT NULL
       AND target_date < date('now')`,
  ).get() as { c: number }).c;

  return { total_open: totalOpen, by_priority: byPriority, overdue };
}

// ── helpers ───────────────────────────────────────────────

function resolveScope(database: Database.Database, ref: string | undefined): string | null | undefined {
  if (!ref || ref === 'org' || ref === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(ref) as { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(ref) as { id: string } | undefined;
  if (byName) return byName.id;
  return undefined;
}

function resolveCatalog(database: Database.Database, ref: string): string | null {
  const row = database
    .prepare('SELECT id FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1')
    .get(ref, ref) as { id: string } | undefined;
  return row?.id ?? null;
}

function tableExists(database: Database.Database, name: string): boolean {
  const row = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name);
  return !!row;
}

function pickTop(frameworks: Array<{ catalog_short_name: string | null; overall_score: number }>, dir: 'asc' | 'desc') {
  if (frameworks.length === 0) return null;
  const sorted = [...frameworks].sort((a, b) => dir === 'desc' ? b.overall_score - a.overall_score : a.overall_score - b.overall_score);
  return sorted[0];
}

function parsePositiveInt(v: any, def: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
