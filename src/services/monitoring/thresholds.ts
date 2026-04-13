import type Database from 'better-sqlite3';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { DEFAULT_THRESHOLDS, type MonitoringThresholds } from '../../models/monitoring.js';

/**
 * Monitoring threshold CRUD + resolution.
 *
 * Resolution order for a given (scope_id, catalog_id):
 *   1. exact match
 *   2. scope-only (catalog NULL)
 *   3. catalog-only (scope NULL)
 *   4. global (both NULL)
 *   5. built-in DEFAULT_THRESHOLDS
 */

export function resolveThresholds(
  db: Database.Database,
  scopeId: string | null,
  catalogId: string,
): MonitoringThresholds {
  const candidates = [
    { scope: scopeId, catalog: catalogId },
    { scope: scopeId, catalog: null },
    { scope: null,    catalog: catalogId },
    { scope: null,    catalog: null },
  ];

  for (const c of candidates) {
    const row = db.prepare(`
      SELECT * FROM monitoring_thresholds
      WHERE ${c.scope === null ? 'scope_id IS NULL' : 'scope_id = ?'}
        AND ${c.catalog === null ? 'catalog_id IS NULL' : 'catalog_id = ?'}
      LIMIT 1
    `).get(
      ...(c.scope === null ? [] : [c.scope]),
      ...(c.catalog === null ? [] : [c.catalog]),
    ) as any | undefined;

    // First match wins (enabled or not). A disabled explicit row means
    // "monitoring is off for this pair" — don't fall through to defaults.
    if (row) return hydrate(row);
  }

  // Synthetic fallback so callers always get a threshold object.
  return {
    id: 'default',
    scope_id: null,
    catalog_id: null,
    warning_threshold: DEFAULT_THRESHOLDS.warning_threshold,
    critical_threshold: DEFAULT_THRESHOLDS.critical_threshold,
    delta_warning: DEFAULT_THRESHOLDS.delta_warning,
    delta_critical: DEFAULT_THRESHOLDS.delta_critical,
    trend_window: DEFAULT_THRESHOLDS.trend_window,
    enabled: true,
    created_at: '',
    updated_at: '',
  };
}

export function listThresholds(db: Database.Database): MonitoringThresholds[] {
  const rows = db.prepare(`
    SELECT * FROM monitoring_thresholds
    ORDER BY (scope_id IS NULL), scope_id, (catalog_id IS NULL), catalog_id
  `).all() as any[];
  return rows.map(hydrate);
}

export interface UpsertInput {
  scope_id?: string | null;
  catalog_id?: string | null;
  warning_threshold?: number;
  critical_threshold?: number;
  delta_warning?: number;
  delta_critical?: number;
  trend_window?: number;
  enabled?: boolean;
}

export function upsertThreshold(db: Database.Database, input: UpsertInput): MonitoringThresholds {
  const scopeId = input.scope_id ?? null;
  const catalogId = input.catalog_id ?? null;

  const existing = db.prepare(`
    SELECT id FROM monitoring_thresholds
    WHERE ${scopeId === null ? 'scope_id IS NULL' : 'scope_id = ?'}
      AND ${catalogId === null ? 'catalog_id IS NULL' : 'catalog_id = ?'}
  `).get(
    ...(scopeId === null ? [] : [scopeId]),
    ...(catalogId === null ? [] : [catalogId]),
  ) as { id: string } | undefined;

  const ts = now();

  if (existing) {
    const fields: string[] = [];
    const params: unknown[] = [];
    const assign = (col: string, v: unknown) => {
      if (v !== undefined) { fields.push(`${col} = ?`); params.push(v); }
    };
    assign('warning_threshold', input.warning_threshold);
    assign('critical_threshold', input.critical_threshold);
    assign('delta_warning', input.delta_warning);
    assign('delta_critical', input.delta_critical);
    assign('trend_window', input.trend_window);
    if (input.enabled !== undefined) { fields.push('enabled = ?'); params.push(input.enabled ? 1 : 0); }
    fields.push('updated_at = ?'); params.push(ts);
    db.prepare(`UPDATE monitoring_thresholds SET ${fields.join(', ')} WHERE id = ?`).run(...params, existing.id);
    return fetchById(db, existing.id)!;
  }

  const id = generateUuid();
  db.prepare(`
    INSERT INTO monitoring_thresholds
      (id, scope_id, catalog_id, warning_threshold, critical_threshold,
       delta_warning, delta_critical, trend_window, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    scopeId,
    catalogId,
    input.warning_threshold ?? DEFAULT_THRESHOLDS.warning_threshold,
    input.critical_threshold ?? DEFAULT_THRESHOLDS.critical_threshold,
    input.delta_warning ?? DEFAULT_THRESHOLDS.delta_warning,
    input.delta_critical ?? DEFAULT_THRESHOLDS.delta_critical,
    input.trend_window ?? DEFAULT_THRESHOLDS.trend_window,
    input.enabled === false ? 0 : 1,
    ts,
    ts,
  );
  return fetchById(db, id)!;
}

export function deleteThreshold(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM monitoring_thresholds WHERE id = ?').run(id);
}

function fetchById(db: Database.Database, id: string): MonitoringThresholds | null {
  const row = db.prepare('SELECT * FROM monitoring_thresholds WHERE id = ?').get(id) as any;
  return row ? hydrate(row) : null;
}

function hydrate(row: any): MonitoringThresholds {
  return {
    id: row.id,
    scope_id: row.scope_id,
    catalog_id: row.catalog_id,
    warning_threshold: row.warning_threshold,
    critical_threshold: row.critical_threshold,
    delta_warning: row.delta_warning,
    delta_critical: row.delta_critical,
    trend_window: row.trend_window,
    enabled: !!row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
