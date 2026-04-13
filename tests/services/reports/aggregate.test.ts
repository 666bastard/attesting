import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
  seedImplementation,
} from '../../helpers/test-db.js';
import { generateUuid } from '../../../src/utils/uuid.js';
import { aggregateReportData } from '../../../src/services/reports/aggregate.js';
import { snapshotScore } from '../../../src/services/scoring/snapshot.js';

function insertEvidence(
  db: Database.Database,
  implId: string,
  status: string = 'accepted',
  collectedAt: string = new Date().toISOString(),
): string {
  const id = generateUuid();
  db.prepare(
    `INSERT INTO evidence (id, implementation_id, title, status, collected_at, created_at)
     VALUES (?, ?, 'ev', ?, ?, datetime('now'))`,
  ).run(id, implId, status, collectedAt);
  return id;
}

function insertRisk(db: Database.Database, score: number, status = 'open'): void {
  db.prepare(
    `INSERT INTO risks (id, risk_id, title, likelihood, impact, inherent_risk_score, owner, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'owner', ?, datetime('now'), datetime('now'))`,
  ).run(generateUuid(), `RISK-${score}`, `Risk ${score}`, 5, Math.ceil(score / 5), score, status);
}

function insertPoam(db: Database.Database, orgId: string, controlId: string, daysOffset: number): void {
  const arId = generateUuid();
  const aId = generateUuid();
  db.prepare(
    `INSERT INTO assessments (id, org_id, catalog_id, name, status, created_at)
     VALUES (?, ?, (SELECT id FROM catalogs LIMIT 1), 'a', 'completed', datetime('now'))`,
  ).run(aId, orgId);
  db.prepare(
    `INSERT INTO assessment_results (id, assessment_id, control_id, result)
     VALUES (?, ?, ?, 'not-satisfied')`,
  ).run(arId, aId, controlId);
  const target = new Date(Date.now() + daysOffset * 86400_000).toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO poam_items
       (id, org_id, assessment_result_id, control_id, poam_id, priority, finding, required_action, status, target_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'high', 'f', 'r', 'in-progress', ?, datetime('now'), datetime('now'))`,
  ).run(generateUuid(), orgId, arId, controlId, `POAM-${daysOffset}`, target);
}

describe('aggregateReportData', () => {
  let db: Database.Database;
  let orgId: string;
  let catId: string;
  let controlIds: string[];

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    ({ catId, controlIds } = seedCatalog(db, 4));
  });

  it('returns the full envelope on an empty scope', () => {
    const data = aggregateReportData(db, { catalog_id: catId });
    expect(data.organization.name).toBe('Test Org');
    expect(data.catalog.id).toBe(catId);
    expect(data.scope.name).toBe('Organization-wide');
    expect(data.controls).toHaveLength(4);
    expect(data.controls.every((c) => c.impl_status === null)).toBe(true);
    expect(data.risks.total_open).toBe(0);
    expect(data.poam.total_open).toBe(0);
    expect(data.trend).toEqual([]);
    expect(data.methodology.evidence_fresh_days).toBe(365);
  });

  it('populates control rows with implementation status', () => {
    seedImplementation(db, orgId, controlIds[0], 'implemented');
    seedImplementation(db, orgId, controlIds[1], 'partially-implemented');
    seedImplementation(db, orgId, controlIds[2], 'not-applicable');

    const data = aggregateReportData(db, { catalog_id: catId });
    const byControl = new Map(data.controls.map((c) => [c.control_id, c]));
    expect(byControl.get('AC-1')?.impl_status).toBe('implemented');
    expect(byControl.get('AC-2')?.impl_status).toBe('partially-implemented');
    expect(byControl.get('AC-3')?.impl_status).toBe('not-applicable');
    expect(byControl.get('AC-4')?.impl_status).toBeNull();
  });

  it('counts evidence per control and reports freshness summary', () => {
    const implId = seedImplementation(db, orgId, controlIds[0], 'implemented');
    insertEvidence(db, implId, 'accepted');
    insertEvidence(db, implId, 'accepted');
    insertEvidence(db, implId, 'expired');

    const data = aggregateReportData(db, { catalog_id: catId });
    const first = data.controls.find((c) => c.control_id === 'AC-1');
    expect(first?.evidence_count).toBe(3);
    expect(first?.evidence_fresh).toBe(2);
    expect(first?.evidence_expired).toBe(1);
  });

  it('loads top risks sorted by inherent score', () => {
    insertRisk(db, 25); // critical
    insertRisk(db, 16); // high
    insertRisk(db, 4);  // low
    insertRisk(db, 20, 'closed'); // excluded

    const data = aggregateReportData(db, { catalog_id: catId });
    expect(data.risks.total_open).toBe(3);
    expect(data.risks.top[0].inherent_risk_score).toBe(25);
    expect(data.risks.top.length).toBe(3);
    const severities = new Set(data.risks.by_severity.map((s) => s.severity));
    expect(severities.has('critical')).toBe(true);
    expect(severities.has('high')).toBe(true);
  });

  it('flags overdue POA&M items', () => {
    insertPoam(db, orgId, controlIds[0], -10); // overdue
    insertPoam(db, orgId, controlIds[1], 30);  // future

    const data = aggregateReportData(db, { catalog_id: catId });
    expect(data.poam.total_open).toBe(2);
    expect(data.poam.overdue).toBe(1);
  });

  it('includes trend history after snapshots are taken', () => {
    seedImplementation(db, orgId, controlIds[0], 'implemented');
    snapshotScore(db, catId);
    seedImplementation(db, orgId, controlIds[1], 'implemented');
    snapshotScore(db, catId);

    const data = aggregateReportData(db, { catalog_id: catId });
    expect(data.trend.length).toBeGreaterThanOrEqual(2);
    expect(data.score_fresh).toBe(true);
  });

  it('throws for unknown catalog', () => {
    expect(() => aggregateReportData(db, { catalog_id: 'nope' })).toThrow(/not found/);
  });
});
