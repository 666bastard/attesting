import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
  seedImplementation,
} from '../../helpers/test-db.js';
import { generateUuid } from '../../../src/utils/uuid.js';
import { calculateScore } from '../../../src/services/scoring/compliance-score.js';
import {
  snapshotScore,
  getLatestScore,
  getScoreHistory,
  getScoresForScope,
} from '../../../src/services/scoring/snapshot.js';

function insertImpl(
  db: Database.Database,
  orgId: string,
  controlId: string,
  status: string,
  scopeId: string | null = null,
): string {
  const id = generateUuid();
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO implementations (id, org_id, scope_id, primary_control_id, status, statement, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'x', ?, ?)`,
  ).run(id, orgId, scopeId, controlId, status, ts, ts);
  return id;
}

function insertEvidence(
  db: Database.Database,
  implId: string,
  collectedAt: string,
): string {
  const id = generateUuid();
  db.prepare(
    `INSERT INTO evidence (id, implementation_id, title, collected_at, created_at)
     VALUES (?, ?, 'ev', ?, datetime('now'))`,
  ).run(id, implId, collectedAt);
  return id;
}

function insertAssessment(
  db: Database.Database,
  orgId: string,
  catalogId: string,
  results: Array<{ controlId: string; result: string }>,
): string {
  const aid = generateUuid();
  db.prepare(
    `INSERT INTO assessments (id, org_id, catalog_id, name, status, created_at)
     VALUES (?, ?, ?, 'a', 'completed', datetime('now'))`,
  ).run(aid, orgId, catalogId);
  for (const r of results) {
    db.prepare(
      `INSERT INTO assessment_results (id, assessment_id, control_id, result)
       VALUES (?, ?, ?, ?)`,
    ).run(generateUuid(), aid, r.controlId, r.result);
  }
  return aid;
}

describe('calculateScore', () => {
  let db: Database.Database;
  let orgId: string;
  let catId: string;
  let controlIds: string[];

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    const seeded = seedCatalog(db, 4);
    catId = seeded.catId;
    controlIds = seeded.controlIds;
  });

  it('returns zero composite when no implementations or evidence exist', () => {
    const s = calculateScore(db, catId);
    expect(s.total_controls).toBe(4);
    expect(s.implemented_count).toBe(0);
    expect(s.not_implemented_count).toBe(4);
    expect(s.coverage_score).toBe(0);
    expect(s.evidence_score).toBeNull();
    expect(s.assessment_score).toBeNull();
    expect(s.overall_score).toBe(0);
    // Renormalization: only coverage is non-null, so it gets full weight
    expect(s.coverage_weight).toBe(1);
  });

  it('weights control statuses correctly', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertImpl(db, orgId, controlIds[1], 'partially-implemented');
    insertImpl(db, orgId, controlIds[2], 'planned');
    insertImpl(db, orgId, controlIds[3], 'not-implemented');

    const s = calculateScore(db, catId);
    // (1.0 + 0.5 + 0.25 + 0) / 4 = 0.4375 -> 43.75
    expect(s.coverage_score).toBeCloseTo(43.75, 2);
    expect(s.implemented_count).toBe(1);
    expect(s.partial_count).toBe(1);
    expect(s.planned_count).toBe(1);
    expect(s.not_implemented_count).toBe(1);
  });

  it('excludes not-applicable controls from denominator', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertImpl(db, orgId, controlIds[1], 'implemented');
    insertImpl(db, orgId, controlIds[2], 'not-applicable');
    insertImpl(db, orgId, controlIds[3], 'not-applicable');

    const s = calculateScore(db, catId);
    expect(s.coverage_score).toBe(100); // 2/2 effective
    expect(s.not_applicable_count).toBe(2);
    expect(s.implemented_count).toBe(2);
  });

  it('returns null sub-score when entire catalog is N/A', () => {
    for (const cid of controlIds) insertImpl(db, orgId, cid, 'not-applicable');
    const s = calculateScore(db, catId);
    expect(s.coverage_score).toBeNull();
    expect(s.overall_score).toBe(0);
  });

  it('computes evidence sub-score and counts fresh vs stale', () => {
    const i1 = insertImpl(db, orgId, controlIds[0], 'implemented');
    const i2 = insertImpl(db, orgId, controlIds[1], 'implemented');
    // Fresh (today)
    insertEvidence(db, i1, new Date().toISOString());
    // Stale (400 days ago)
    const stale = new Date();
    stale.setDate(stale.getDate() - 400);
    insertEvidence(db, i2, stale.toISOString());

    const s = calculateScore(db, catId);
    expect(s.total_evidence_count).toBe(2);
    expect(s.fresh_evidence_count).toBe(1);
    expect(s.stale_evidence_count).toBe(1);
    expect(s.evidence_score).toBe(50);
  });

  it('computes assessment sub-score from assessment_results', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertAssessment(db, orgId, catId, [
      { controlId: controlIds[0], result: 'satisfied' },
      { controlId: controlIds[1], result: 'satisfied' },
      { controlId: controlIds[2], result: 'partial' },
      { controlId: controlIds[3], result: 'not-satisfied' },
    ]);

    const s = calculateScore(db, catId);
    expect(s.satisfied_assessment_count).toBe(2);
    expect(s.partial_assessment_count).toBe(1);
    expect(s.not_satisfied_assessment_count).toBe(1);
    // (2 + 0.5) / 4 = 0.625 -> 62.5
    expect(s.assessment_score).toBeCloseTo(62.5, 2);
  });

  it('composes overall score with default weights when all sub-scores present', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertImpl(db, orgId, controlIds[1], 'implemented');
    insertImpl(db, orgId, controlIds[2], 'implemented');
    insertImpl(db, orgId, controlIds[3], 'implemented');
    const i1 = controlIds[0];
    insertEvidence(db, insertImpl(db, orgId, i1, 'implemented'), new Date().toISOString());
    insertAssessment(db, orgId, catId, [
      { controlId: controlIds[0], result: 'satisfied' },
    ]);

    const s = calculateScore(db, catId);
    // Coverage = 100, evidence = 100, assessment = 100
    // Overall = 100 * 0.5 + 100 * 0.3 + 100 * 0.2 = 100
    expect(s.overall_score).toBe(100);
    expect(s.coverage_weight).toBe(0.5);
    expect(s.evidence_weight).toBe(0.3);
    expect(s.assessment_weight).toBe(0.2);
  });

  it('renormalizes weights when evidence and assessment are missing', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertImpl(db, orgId, controlIds[1], 'partially-implemented');
    insertImpl(db, orgId, controlIds[2], 'not-implemented');
    insertImpl(db, orgId, controlIds[3], 'not-implemented');

    const s = calculateScore(db, catId);
    expect(s.coverage_score).toBeCloseTo(37.5, 2); // (1+0.5)/4
    expect(s.evidence_score).toBeNull();
    expect(s.assessment_score).toBeNull();
    expect(s.overall_score).toBeCloseTo(37.5, 2); // coverage alone
    expect(s.coverage_weight).toBe(1);
    expect(s.evidence_weight).toBe(0);
    expect(s.assessment_weight).toBe(0);
  });

  it('produces per-family breakdown', () => {
    // family column is populated by the helper via control_id prefix
    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertImpl(db, orgId, controlIds[1], 'implemented');
    insertImpl(db, orgId, controlIds[2], 'not-implemented');

    const s = calculateScore(db, catId);
    expect(s.family_breakdown.length).toBeGreaterThan(0);
    const total = s.family_breakdown.reduce((sum, f) => sum + f.total, 0);
    expect(total).toBe(4);
  });

  it('filters by scope when provided', () => {
    const scopeId = generateUuid();
    db.prepare(
      `INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at)
       VALUES (?, ?, 'prod', 'product', datetime('now'), datetime('now'))`,
    ).run(scopeId, orgId);

    insertImpl(db, orgId, controlIds[0], 'implemented', scopeId);
    // no scope-scoped impls for 1..3

    const s = calculateScore(db, catId, scopeId);
    expect(s.implemented_count).toBe(1);
    expect(s.not_implemented_count).toBe(3);
  });
});

describe('snapshotScore + history', () => {
  let db: Database.Database;
  let orgId: string;
  let catId: string;
  let controlIds: string[];

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    const seeded = seedCatalog(db, 4);
    catId = seeded.catId;
    controlIds = seeded.controlIds;
  });

  it('persists a snapshot and reads it back', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    const snap = snapshotScore(db, catId);

    expect(snap.id).toBeDefined();
    expect(snap.calculated_at).toBeDefined();

    const latest = getLatestScore(db, catId);
    expect(latest).toBeDefined();
    expect(latest!.overall_score).toBe(snap.overall_score);
  });

  it('overwrites the snapshot row on repeat but appends history', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    snapshotScore(db, catId);
    snapshotScore(db, catId);
    snapshotScore(db, catId);

    const snapshotRows = db.prepare('SELECT COUNT(*) AS c FROM compliance_scores WHERE catalog_id = ?').get(catId) as { c: number };
    const historyRows = db.prepare('SELECT COUNT(*) AS c FROM compliance_score_history WHERE catalog_id = ?').get(catId) as { c: number };

    expect(snapshotRows.c).toBe(1);
    expect(historyRows.c).toBe(3);
  });

  it('getScoreHistory returns ordered entries within window', () => {
    insertImpl(db, orgId, controlIds[0], 'implemented');
    snapshotScore(db, catId);
    insertImpl(db, orgId, controlIds[1], 'implemented');
    snapshotScore(db, catId);

    const hist = getScoreHistory(db, catId, null, 30);
    expect(hist.length).toBe(2);
    // Second snapshot should have a higher score
    expect(hist[1].overall_score).toBeGreaterThanOrEqual(hist[0].overall_score);
  });

  it('getScoresForScope returns all catalogs for a scope', () => {
    // Seed a second catalog manually (seedCatalog uses a fixed short_name)
    const cat2 = generateUuid();
    db.prepare(
      `INSERT INTO catalogs (id, name, short_name, source_format, total_controls, created_at, updated_at)
       VALUES (?, 'Alt FW', 'alt-fw', 'csv', 2, datetime('now'), datetime('now'))`,
    ).run(cat2);
    const c2a = generateUuid();
    db.prepare(
      `INSERT INTO controls (id, catalog_id, control_id, title, metadata, sort_order, created_at)
       VALUES (?, ?, 'ZZ-1', 'c1', '{}', 1, datetime('now'))`,
    ).run(c2a, cat2);

    insertImpl(db, orgId, controlIds[0], 'implemented');
    insertImpl(db, orgId, c2a, 'implemented');
    snapshotScore(db, catId);
    snapshotScore(db, cat2);

    const all = getScoresForScope(db, null);
    expect(all.length).toBe(2);
  });

  it('scope-filtered snapshots do not overwrite org-wide snapshots', () => {
    const scopeId = generateUuid();
    db.prepare(
      `INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at)
       VALUES (?, ?, 'prod', 'product', datetime('now'), datetime('now'))`,
    ).run(scopeId, orgId);

    snapshotScore(db, catId, null);
    snapshotScore(db, catId, scopeId);

    const rows = db.prepare('SELECT COUNT(*) AS c FROM compliance_scores WHERE catalog_id = ?').get(catId) as { c: number };
    expect(rows.c).toBe(2);
  });
});
