import { Router } from 'express';
import { db } from '../../db/connection.js';
import { runPostureMonitor, evaluate } from '../../services/monitoring/posture-monitor.js';
import {
  resolveThresholds,
  listThresholds,
  upsertThreshold,
  deleteThreshold,
} from '../../services/monitoring/thresholds.js';

/**
 * Phase 8D — Continuous monitoring API.
 *
 *   GET  /api/monitoring/status               current posture findings + summary
 *   POST /api/monitoring/run                  run monitor on demand
 *   GET  /api/monitoring/thresholds           list all configured thresholds
 *   PUT  /api/monitoring/thresholds           upsert a threshold config
 *   DELETE /api/monitoring/thresholds/:id     remove a threshold row
 *   GET  /api/monitoring/thresholds/resolve   resolve effective thresholds for a pair
 */
export function monitoringRoutes(): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const database = db.getDb();

    // Snapshot of current state — read-only, doesn't create new alerts.
    const findings = buildFindingsReadOnly(database);
    const recentAlerts = database.prepare(`
      SELECT id, severity, title, message, created_at, resolved_at
      FROM drift_alerts
      WHERE alert_type = 'posture_change'
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    const summary = {
      total_checked: findings.length,
      threshold_breaches: findings.filter((f) => f.threshold_breached).length,
      delta_breaches: findings.filter((f) => f.delta_breached).length,
      trend_breaches: findings.filter((f) => f.trend_breached).length,
      declining: findings.filter((f) => f.consecutive_drops >= 1).length,
    };

    res.json({
      generated_at: new Date().toISOString(),
      summary,
      findings,
      recent_alerts: recentAlerts,
    });
  });

  router.post('/run', (_req, res) => {
    const database = db.getDb();
    const result = runPostureMonitor(database);
    res.json(result);
  });

  router.get('/thresholds', (_req, res) => {
    const database = db.getDb();
    res.json(listThresholds(database));
  });

  router.get('/thresholds/resolve', (req, res) => {
    const database = db.getDb();
    const scopeRef = typeof req.query.scope === 'string' ? req.query.scope : undefined;
    const catalogRef = typeof req.query.catalog === 'string' ? req.query.catalog : undefined;

    if (!catalogRef) {
      res.status(400).json({ error: 'catalog query parameter is required' });
      return;
    }

    const scopeId = resolveScope(database, scopeRef);
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${scopeRef}" not found` });
      return;
    }
    const catalogId = resolveCatalog(database, catalogRef);
    if (!catalogId) {
      res.status(404).json({ error: `Catalog "${catalogRef}" not found` });
      return;
    }

    res.json(resolveThresholds(database, scopeId, catalogId));
  });

  router.put('/thresholds', (req, res) => {
    const database = db.getDb();
    const body = req.body ?? {};
    const scopeId = body.scope_id ?? null;
    const catalogId = body.catalog_id ?? null;

    // Light validation
    for (const key of ['warning_threshold', 'critical_threshold', 'delta_warning', 'delta_critical'] as const) {
      if (body[key] !== undefined && (typeof body[key] !== 'number' || body[key] < 0)) {
        res.status(400).json({ error: `${key} must be a non-negative number` });
        return;
      }
    }
    if (body.trend_window !== undefined && (!Number.isInteger(body.trend_window) || body.trend_window < 1)) {
      res.status(400).json({ error: 'trend_window must be a positive integer' });
      return;
    }

    const row = upsertThreshold(database, {
      scope_id: scopeId,
      catalog_id: catalogId,
      warning_threshold: body.warning_threshold,
      critical_threshold: body.critical_threshold,
      delta_warning: body.delta_warning,
      delta_critical: body.delta_critical,
      trend_window: body.trend_window,
      enabled: body.enabled,
    });
    res.json(row);
  });

  router.delete('/thresholds/:id', (req, res) => {
    const database = db.getDb();
    deleteThreshold(database, req.params.id);
    res.json({ deleted: true });
  });

  return router;
}

// ── helpers ───────────────────────────────────────────────

function buildFindingsReadOnly(database: any): any[] {
  const snapshots = database.prepare(`
    SELECT cs.id, cs.scope_id, cs.catalog_id, cs.overall_score, cs.calculated_at,
           cat.short_name AS catalog_short_name
    FROM compliance_scores cs
    JOIN catalogs cat ON cs.catalog_id = cat.id
    ORDER BY cs.catalog_id, cs.scope_id
  `).all() as any[];

  return snapshots.map((snap: any) => {
    const thresholds = resolveThresholds(database, snap.scope_id, snap.catalog_id);
    const history = database.prepare(`
      SELECT overall_score, calculated_at
      FROM compliance_score_history
      WHERE catalog_id = ?
        AND ${snap.scope_id === null ? 'scope_id IS NULL' : 'scope_id = ?'}
      ORDER BY calculated_at DESC, rowid DESC
      LIMIT ?
    `).all(
      ...(snap.scope_id === null
        ? [snap.catalog_id, thresholds.trend_window + 1]
        : [snap.catalog_id, snap.scope_id, thresholds.trend_window + 1]),
    ) as any[];

    return evaluate(snap, history, thresholds);
  });
}

function resolveScope(database: any, ref: string | undefined): string | null | undefined {
  if (!ref || ref === 'org' || ref === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(ref) as { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(ref) as { id: string } | undefined;
  if (byName) return byName.id;
  return undefined;
}

function resolveCatalog(database: any, ref: string): string | null {
  const row = database
    .prepare('SELECT id FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1')
    .get(ref, ref) as { id: string } | undefined;
  return row?.id ?? null;
}
