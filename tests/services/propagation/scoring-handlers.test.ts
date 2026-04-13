import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
  seedImplementation,
} from '../../helpers/test-db.js';
import { generateUuid } from '../../../src/utils/uuid.js';
import { propagate } from '../../../src/services/propagation/dispatcher.js';
import { getLatestScore } from '../../../src/services/scoring/snapshot.js';
import type { Actor } from '../../../src/services/audit/logger.js';

const actor: Actor = { type: 'user', id: 'test' };

describe('scoring propagation handlers', () => {
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

  it('implementation propagation triggers a score snapshot', () => {
    const implId = seedImplementation(db, orgId, controlIds[0], 'implemented');

    const log = propagate(db, 'implementation', implId, 'update', actor,
      { status: 'not-implemented' }, { status: 'implemented' });

    expect(log.some((e) => e.type === 'score_recalculated')).toBe(true);
    const latest = getLatestScore(db, catId);
    expect(latest).toBeDefined();
    expect(latest!.implemented_count).toBe(1);
  });

  it('evidence propagation triggers a score snapshot', () => {
    const implId = seedImplementation(db, orgId, controlIds[0], 'implemented');
    const evidenceId = generateUuid();
    db.prepare(
      `INSERT INTO evidence (id, implementation_id, title, collected_at, created_at)
       VALUES (?, ?, 'ev', datetime('now'), datetime('now'))`,
    ).run(evidenceId, implId);

    const log = propagate(db, 'evidence', evidenceId, 'create', actor);
    expect(log.some((e) => e.type === 'score_recalculated')).toBe(true);
  });

  it('assessment propagation triggers a score snapshot', () => {
    const assessmentId = generateUuid();
    db.prepare(
      `INSERT INTO assessments (id, org_id, catalog_id, name, status, created_at)
       VALUES (?, ?, ?, 'a', 'completed', datetime('now'))`,
    ).run(assessmentId, orgId, catId);

    const log = propagate(db, 'assessment', assessmentId, 'update', actor);
    expect(log.some((e) => e.type === 'score_recalculated')).toBe(true);
  });

  it('recalc is idempotent — snapshot row stays at one per (catalog, scope)', () => {
    const implId = seedImplementation(db, orgId, controlIds[0], 'implemented');

    propagate(db, 'implementation', implId, 'update', actor,
      { status: 'not-implemented' }, { status: 'implemented' });
    propagate(db, 'implementation', implId, 'update', actor,
      { status: 'implemented' }, { status: 'implemented' });
    propagate(db, 'implementation', implId, 'update', actor,
      { status: 'implemented' }, { status: 'implemented' });

    const rows = db.prepare(
      'SELECT COUNT(*) AS c FROM compliance_scores WHERE catalog_id = ?',
    ).get(catId) as { c: number };
    expect(rows.c).toBe(1);

    const hist = db.prepare(
      'SELECT COUNT(*) AS c FROM compliance_score_history WHERE catalog_id = ?',
    ).get(catId) as { c: number };
    expect(hist.c).toBe(3);
  });

  it('does not fire when referenced entity does not exist', () => {
    const log = propagate(db, 'implementation', 'nonexistent', 'update', actor,
      { status: 'not-implemented' }, { status: 'implemented' });
    expect(log.some((e) => e.type === 'score_recalculated')).toBe(false);
    const rows = db.prepare('SELECT COUNT(*) AS c FROM compliance_scores').get() as { c: number };
    expect(rows.c).toBe(0);
  });
});
