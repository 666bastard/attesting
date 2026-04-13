import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
} from '../../helpers/test-db.js';
import { generateUuid } from '../../../src/utils/uuid.js';
import {
  runPostureMonitor,
  evaluate,
  countConsecutiveDrops,
} from '../../../src/services/monitoring/posture-monitor.js';
import {
  upsertThreshold,
  resolveThresholds,
  listThresholds,
} from '../../../src/services/monitoring/thresholds.js';
import { snapshotScore } from '../../../src/services/scoring/snapshot.js';
import { DEFAULT_THRESHOLDS } from '../../../src/models/monitoring.js';

function insertImpl(db: Database.Database, orgId: string, controlId: string, status: string): void {
  db.prepare(
    `INSERT INTO implementations (id, org_id, primary_control_id, status, statement, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'x', datetime('now'), datetime('now'))`,
  ).run(generateUuid(), orgId, controlId, status);
}

function insertHistoryPoint(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null,
  score: number,
  ageSeconds: number,
): void {
  const ts = new Date(Date.now() - ageSeconds * 1000).toISOString();
  db.prepare(
    `INSERT INTO compliance_score_history
       (id, scope_id, catalog_id, overall_score, family_breakdown, trigger, calculated_at)
     VALUES (?, ?, ?, ?, '[]', 'manual', ?)`,
  ).run(generateUuid(), scopeId, catalogId, score, ts);
}

describe('posture-monitor helpers', () => {
  describe('countConsecutiveDrops', () => {
    it('counts drops walking newest→oldest', () => {
      // newest first: 70 < 80 < 90 → 2 drops
      expect(countConsecutiveDrops([
        { overall_score: 70, calculated_at: '' },
        { overall_score: 80, calculated_at: '' },
        { overall_score: 90, calculated_at: '' },
      ])).toBe(2);
    });

    it('stops at first non-drop', () => {
      // 70 < 80 then 80 >= 75 → stops at 1
      expect(countConsecutiveDrops([
        { overall_score: 70, calculated_at: '' },
        { overall_score: 80, calculated_at: '' },
        { overall_score: 75, calculated_at: '' },
      ])).toBe(1);
    });

    it('returns 0 for rising scores', () => {
      expect(countConsecutiveDrops([
        { overall_score: 90, calculated_at: '' },
        { overall_score: 80, calculated_at: '' },
      ])).toBe(0);
    });

    it('returns 0 for single point', () => {
      expect(countConsecutiveDrops([{ overall_score: 50, calculated_at: '' }])).toBe(0);
    });
  });

  describe('evaluate', () => {
    const baseSnap = {
      id: 'snap-1',
      scope_id: null,
      catalog_id: 'cat-1',
      catalog_short_name: 'test-fw',
      overall_score: 85,
      calculated_at: new Date().toISOString(),
    };
    const thresholds = {
      id: 'default',
      scope_id: null,
      catalog_id: null,
      warning_threshold: 80,
      critical_threshold: 60,
      delta_warning: 5,
      delta_critical: 10,
      trend_window: 3,
      enabled: true,
      created_at: '',
      updated_at: '',
    };

    it('no breach when score is above warning', () => {
      const f = evaluate(baseSnap, [
        { overall_score: 85, calculated_at: '' },
        { overall_score: 84, calculated_at: '' },
      ], thresholds);
      expect(f.threshold_breached).toBe(false);
      expect(f.delta_breached).toBe(false);
      expect(f.trend_breached).toBe(false);
    });

    it('raises warning threshold when score < warning', () => {
      const f = evaluate({ ...baseSnap, overall_score: 70 }, [
        { overall_score: 70, calculated_at: '' },
        { overall_score: 72, calculated_at: '' },
      ], thresholds);
      expect(f.threshold_breached).toBe(true);
      expect(f.threshold_kind).toBe('warning');
      expect(f.threshold_severity).toBe('high');
    });

    it('raises critical threshold when score < critical', () => {
      const f = evaluate({ ...baseSnap, overall_score: 50 }, [
        { overall_score: 50, calculated_at: '' },
        { overall_score: 55, calculated_at: '' },
      ], thresholds);
      expect(f.threshold_breached).toBe(true);
      expect(f.threshold_kind).toBe('critical');
      expect(f.threshold_severity).toBe('critical');
    });

    it('raises delta warning when drop >= delta_warning and < delta_critical', () => {
      const f = evaluate({ ...baseSnap, overall_score: 85 }, [
        { overall_score: 85, calculated_at: '' },
        { overall_score: 91, calculated_at: '' },
      ], thresholds);
      expect(f.delta).toBe(6);
      expect(f.delta_breached).toBe(true);
      expect(f.delta_severity).toBe('high');
    });

    it('raises delta critical when drop >= delta_critical', () => {
      const f = evaluate({ ...baseSnap, overall_score: 70 }, [
        { overall_score: 70, calculated_at: '' },
        { overall_score: 85, calculated_at: '' },
      ], thresholds);
      expect(f.delta).toBe(15);
      expect(f.delta_severity).toBe('critical');
    });

    it('ignores improvements (negative delta)', () => {
      const f = evaluate({ ...baseSnap, overall_score: 95 }, [
        { overall_score: 95, calculated_at: '' },
        { overall_score: 80, calculated_at: '' },
      ], thresholds);
      expect(f.delta).toBe(-15);
      expect(f.delta_breached).toBe(false);
    });

    it('raises trend alert when consecutive drops >= trend_window', () => {
      const f = evaluate({ ...baseSnap, overall_score: 82 }, [
        { overall_score: 82, calculated_at: '' },
        { overall_score: 86, calculated_at: '' },
        { overall_score: 88, calculated_at: '' },
        { overall_score: 90, calculated_at: '' },
      ], thresholds);
      expect(f.consecutive_drops).toBe(3);
      expect(f.trend_breached).toBe(true);
    });

    it('no trend alert below trend_window', () => {
      const f = evaluate({ ...baseSnap, overall_score: 82 }, [
        { overall_score: 82, calculated_at: '' },
        { overall_score: 86, calculated_at: '' },
        { overall_score: 85, calculated_at: '' },
      ], thresholds);
      expect(f.consecutive_drops).toBe(1);
      expect(f.trend_breached).toBe(false);
    });
  });
});

describe('thresholds service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('resolveThresholds falls back to built-in defaults when nothing configured', () => {
    const t = resolveThresholds(db, null, generateUuid());
    expect(t.warning_threshold).toBe(DEFAULT_THRESHOLDS.warning_threshold);
    expect(t.critical_threshold).toBe(DEFAULT_THRESHOLDS.critical_threshold);
    expect(t.id).toBe('default');
  });

  it('upsert inserts a new row and read-back matches', () => {
    const row = upsertThreshold(db, {
      scope_id: null,
      catalog_id: null,
      warning_threshold: 85,
      critical_threshold: 70,
    });
    expect(row.warning_threshold).toBe(85);
    expect(row.critical_threshold).toBe(70);
    const list = listThresholds(db);
    expect(list.length).toBe(1);
  });

  it('upsert updates an existing row in place', () => {
    upsertThreshold(db, { warning_threshold: 85 });
    upsertThreshold(db, { warning_threshold: 90, critical_threshold: 75 });
    const list = listThresholds(db);
    expect(list.length).toBe(1);
    expect(list[0].warning_threshold).toBe(90);
    expect(list[0].critical_threshold).toBe(75);
  });

  it('resolveThresholds prefers exact match over global', () => {
    const { orgId } = seedOrg(db);
    const { catId } = seedCatalog(db, 1);
    const scopeId = generateUuid();
    db.prepare(
      `INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at)
       VALUES (?, ?, 'prod', 'product', datetime('now'), datetime('now'))`,
    ).run(scopeId, orgId);

    upsertThreshold(db, { warning_threshold: 80 }); // global
    upsertThreshold(db, { scope_id: scopeId, catalog_id: catId, warning_threshold: 95 });

    const resolved = resolveThresholds(db, scopeId, catId);
    expect(resolved.warning_threshold).toBe(95);
  });
});

describe('runPostureMonitor end-to-end', () => {
  let db: Database.Database;
  let orgId: string;
  let catId: string;
  let controlIds: string[];

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    ({ catId, controlIds } = seedCatalog(db, 4));
  });

  it('no findings when there are no snapshots', () => {
    const result = runPostureMonitor(db);
    expect(result.checked).toBe(0);
    expect(result.alerts_created).toBe(0);
  });

  it('generates a threshold alert when score is below critical', () => {
    // All 4 controls not-implemented → coverage 0 → overall 0
    snapshotScore(db, catId);

    const result = runPostureMonitor(db);
    expect(result.checked).toBe(1);
    expect(result.alerts_created).toBeGreaterThanOrEqual(1);

    const alerts = db.prepare(
      `SELECT * FROM drift_alerts WHERE alert_type = 'posture_change'`,
    ).all() as any[];
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe('critical');
  });

  it('generates a delta alert when score drops > delta_critical between snapshots', () => {
    // First snapshot: all implemented → 100
    for (const cid of controlIds) insertImpl(db, orgId, cid, 'implemented');
    snapshotScore(db, catId);

    // Roll back all implementations so next snapshot = 0
    db.prepare('DELETE FROM implementations WHERE org_id = ?').run(orgId);
    snapshotScore(db, catId);

    const result = runPostureMonitor(db);
    const alertTypes = db.prepare(
      `SELECT source_entity_id FROM drift_alerts WHERE alert_type = 'posture_change'`,
    ).all() as Array<{ source_entity_id: string }>;

    expect(alertTypes.some((a) => a.source_entity_id.endsWith(':delta'))).toBe(true);
    expect(alertTypes.some((a) => a.source_entity_id.endsWith(':threshold'))).toBe(true);
    expect(result.alerts_created).toBeGreaterThanOrEqual(2);
  });

  it('generates a trend alert when 3 consecutive history points decline', () => {
    // Seed history for the catalog so the monitor sees a decline pattern.
    insertHistoryPoint(db, catId, null, 90, 300); // oldest
    insertHistoryPoint(db, catId, null, 85, 200);
    insertHistoryPoint(db, catId, null, 82, 100);
    // Latest snapshot: 80 — three drops in a row (80 < 82 < 85 < 90)
    for (let i = 0; i < 3; i++) insertImpl(db, orgId, controlIds[i], 'implemented');
    // Override the snapshot by writing a specific value
    const snap = snapshotScore(db, catId);
    // Manually adjust persisted snapshot to 80 so we can target a trend hit
    db.prepare('UPDATE compliance_scores SET overall_score = 80 WHERE id = ?').run(snap.id);
    insertHistoryPoint(db, catId, null, 80, 10); // newest, matching snapshot

    const result = runPostureMonitor(db);
    const trendAlert = db.prepare(
      `SELECT * FROM drift_alerts WHERE alert_type = 'posture_change' AND source_entity_id LIKE '%:trend'`,
    ).get() as any;
    expect(trendAlert).toBeDefined();
    expect(result.alerts_created).toBeGreaterThan(0);
  });

  it('does not alert when thresholds are disabled for that pair', () => {
    for (const cid of controlIds) insertImpl(db, orgId, cid, 'not-implemented');
    snapshotScore(db, catId);
    upsertThreshold(db, { scope_id: null, catalog_id: catId, enabled: false });

    const result = runPostureMonitor(db);
    expect(result.findings.length).toBe(0);
    expect(result.alerts_created).toBe(0);
  });

  it('deduplicates on repeat runs', () => {
    snapshotScore(db, catId);
    runPostureMonitor(db);
    const firstCount = (db.prepare(
      `SELECT COUNT(*) AS c FROM drift_alerts WHERE alert_type = 'posture_change'`,
    ).get() as { c: number }).c;

    runPostureMonitor(db);
    const secondCount = (db.prepare(
      `SELECT COUNT(*) AS c FROM drift_alerts WHERE alert_type = 'posture_change'`,
    ).get() as { c: number }).c;

    expect(secondCount).toBe(firstCount);
  });
});
