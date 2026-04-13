import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import type Database from 'better-sqlite3';
import { createTestApp } from '../test-app.js';
import { generateUuid } from '../../../src/utils/uuid.js';
import { snapshotScore } from '../../../src/services/scoring/snapshot.js';

function insertImpl(
  db: Database.Database,
  orgId: string,
  controlId: string,
  status: string,
): string {
  const id = generateUuid();
  db.prepare(
    `INSERT INTO implementations (id, org_id, scope_id, primary_control_id, status, statement, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'x', datetime('now'), datetime('now'))`,
  ).run(id, orgId, controlId, status);
  return id;
}

function insertRisk(
  db: Database.Database,
  refNum: number,
  likelihood: number,
  impact: number,
  status = 'open',
): void {
  db.prepare(
    `INSERT INTO risks (id, risk_id, title, likelihood, impact, inherent_risk_score, owner, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'owner', ?, datetime('now'), datetime('now'))`,
  ).run(
    generateUuid(),
    `RISK-${String(refNum).padStart(3, '0')}`,
    `Risk ${refNum}`,
    likelihood,
    impact,
    likelihood * impact,
    status,
  );
}

function insertDriftAlert(db: Database.Database, severity: string, resolved = false): void {
  db.prepare(
    `INSERT INTO drift_alerts
       (id, alert_type, severity, title, message, source_entity_type, source_entity_id, created_at, resolved_at)
     VALUES (?, 'evidence_expired', ?, 't', 'm', 'evidence', ?, datetime('now'), ?)`,
  ).run(
    generateUuid(),
    severity,
    generateUuid(),
    resolved ? new Date().toISOString() : null,
  );
}

describe('Dashboard API routes', () => {
  let app: express.Express;
  let database: Database.Database;
  let orgId: string;
  let controlIds: string[];

  beforeEach(() => {
    ({ app, database } = createTestApp());
    orgId = (database.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string }).id;
    controlIds = (
      database.prepare('SELECT id FROM controls ORDER BY sort_order').all() as Array<{ id: string }>
    ).map((r) => r.id);
  });

  describe('GET /api/dashboard/summary', () => {
    it('returns the full KPI envelope', async () => {
      const res = await request(app).get('/api/dashboard/summary');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('compliance');
      expect(res.body).toHaveProperty('frameworks');
      expect(res.body).toHaveProperty('trend');
      expect(res.body).toHaveProperty('coverage');
      expect(res.body).toHaveProperty('risk');
      expect(res.body).toHaveProperty('drift');
      expect(res.body).toHaveProperty('evidence');
      expect(res.body).toHaveProperty('poam');
      expect(res.body).toHaveProperty('generated_at');
    });

    it('snapshots catalogs on first call when none exist', async () => {
      const beforeCount = (database.prepare('SELECT COUNT(*) AS c FROM compliance_scores').get() as any).c;
      expect(beforeCount).toBe(0);

      await request(app).get('/api/dashboard/summary');

      const afterCount = (database.prepare('SELECT COUNT(*) AS c FROM compliance_scores').get() as any).c;
      expect(afterCount).toBeGreaterThan(0);
    });

    it('returns compliance.overall_score averaged across catalogs', async () => {
      insertImpl(database, orgId, controlIds[0], 'implemented');
      insertImpl(database, orgId, controlIds[1], 'implemented');
      insertImpl(database, orgId, controlIds[2], 'implemented');

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.compliance.overall_score).toBeGreaterThan(0);
      expect(res.body.frameworks.length).toBe(1);
    });

    it('aggregates coverage totals from persisted snapshots', async () => {
      insertImpl(database, orgId, controlIds[0], 'implemented');
      insertImpl(database, orgId, controlIds[1], 'partially-implemented');
      snapshotScore(database, database.prepare('SELECT id FROM catalogs LIMIT 1').get() as any && (database.prepare('SELECT id FROM catalogs LIMIT 1').get() as { id: string }).id);

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.coverage.total_controls).toBe(3);
      expect(res.body.coverage.implemented).toBe(1);
      expect(res.body.coverage.partial).toBe(1);
    });

    it('returns empty risk block when no risks exist', async () => {
      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.risk.total_open).toBe(0);
      expect(res.body.risk.top).toEqual([]);
    });

    it('returns risk aggregation with severity buckets', async () => {
      insertRisk(database, 1, 5, 5); // 25 = critical
      insertRisk(database, 2, 4, 4); // 16 = high
      insertRisk(database, 3, 3, 3); // 9 = medium
      insertRisk(database, 4, 2, 2); // 4 = low
      insertRisk(database, 5, 1, 1); // 1 = info
      insertRisk(database, 6, 5, 5, 'closed');

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.risk.total_open).toBe(5);
      const sev = Object.fromEntries(
        res.body.risk.by_severity.map((r: any) => [r.severity, r.count]),
      );
      expect(sev.critical).toBe(1);
      expect(sev.high).toBe(1);
      expect(sev.medium).toBe(1);
      expect(sev.low).toBe(1);
      expect(sev.info).toBe(1);
      expect(res.body.risk.top.length).toBe(5);
      expect(res.body.risk.top[0].risk_id).toBe('RISK-001');
    });

    it('returns drift aggregation', async () => {
      insertDriftAlert(database, 'critical');
      insertDriftAlert(database, 'high');
      insertDriftAlert(database, 'high');
      insertDriftAlert(database, 'low', true); // resolved, shouldn't count

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.drift.active).toBe(3);
      expect(res.body.drift.recent.length).toBeGreaterThanOrEqual(1);
    });

    it('returns evidence block with freshness totals', async () => {
      const implId = insertImpl(database, orgId, controlIds[0], 'implemented');
      database.prepare(
        `INSERT INTO evidence (id, implementation_id, title, collected_at, created_at)
         VALUES (?, ?, 'ev', datetime('now'), datetime('now'))`,
      ).run(generateUuid(), implId);
      database.prepare(
        `INSERT INTO evidence (id, implementation_id, title, collected_at, created_at)
         VALUES (?, ?, 'ev2', date('now','-400 days'), datetime('now'))`,
      ).run(generateUuid(), implId);

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.evidence.total).toBe(2);
      expect(res.body.evidence.fresh).toBe(1);
      expect(res.body.evidence.stale).toBe(1);
    });

    it('returns POAM aggregation', async () => {
      // seed an assessment result first since poam_items references it
      const arId = generateUuid();
      const assessmentId = generateUuid();
      database.prepare(
        `INSERT INTO assessments (id, org_id, catalog_id, name, status, created_at)
         VALUES (?, ?, (SELECT id FROM catalogs LIMIT 1), 'a', 'completed', datetime('now'))`,
      ).run(assessmentId, orgId);
      database.prepare(
        `INSERT INTO assessment_results (id, assessment_id, control_id, result)
         VALUES (?, ?, ?, 'not-satisfied')`,
      ).run(arId, assessmentId, controlIds[0]);
      database.prepare(
        `INSERT INTO poam_items
           (id, org_id, assessment_result_id, control_id, poam_id, priority, finding, required_action, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'POAM-001', 'high', 'f', 'r', 'in-progress', datetime('now'), datetime('now'))`,
      ).run(generateUuid(), orgId, arId, controlIds[0]);
      database.prepare(
        `INSERT INTO poam_items
           (id, org_id, assessment_result_id, control_id, poam_id, priority, finding, required_action, status, target_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'POAM-002', 'critical', 'f', 'r', 'not-started', date('now','-5 days'), datetime('now'), datetime('now'))`,
      ).run(generateUuid(), orgId, arId, controlIds[0]);

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.poam.total_open).toBe(2);
      expect(res.body.poam.overdue).toBe(1);
    });

    it('returns trend points after snapshots accumulate', async () => {
      const catalogId = (database.prepare('SELECT id FROM catalogs LIMIT 1').get() as { id: string }).id;
      snapshotScore(database, catalogId);
      snapshotScore(database, catalogId);

      const res = await request(app).get('/api/dashboard/summary');
      expect(res.body.trend.points.length).toBeGreaterThanOrEqual(2);
      expect(res.body.trend.catalog_id).toBe(catalogId);
    });

    it('trendDays query param is honored', async () => {
      const res = await request(app).get('/api/dashboard/summary?trendDays=7');
      expect(res.body.trend.since_days).toBe(7);
    });

    it('returns 404 for unknown scope', async () => {
      const res = await request(app).get('/api/dashboard/summary?scope=not-a-scope');
      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown catalog', async () => {
      const res = await request(app).get('/api/dashboard/summary?catalog=not-a-catalog');
      expect(res.status).toBe(404);
    });

    it('scope=org resolves to org-wide (null scope_id)', async () => {
      const res = await request(app).get('/api/dashboard/summary?scope=org');
      expect(res.status).toBe(200);
      expect(res.body.scope.id).toBeNull();
    });
  });
});
