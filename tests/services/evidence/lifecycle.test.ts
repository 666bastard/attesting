import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
  seedImplementation,
} from '../../helpers/test-db.js';
import {
  createEvidence,
  getEvidence,
  listEvidence,
  getStateHistory,
  transition,
  classifyFreshness,
  isTransitionAllowed,
  InvalidTransitionError,
  systemTransition,
} from '../../../src/services/evidence/lifecycle.js';
import {
  sweepExpiry,
  getFreshnessSummary,
} from '../../../src/services/evidence/freshness.js';
import type { Actor } from '../../../src/services/audit/logger.js';

const ACTOR: Actor = { type: 'user', id: 'test' };

describe('evidence state machine', () => {
  describe('isTransitionAllowed', () => {
    it('permits draft→submit', () => expect(isTransitionAllowed('draft', 'submit')).toBe(true));
    it('permits submitted→review', () => expect(isTransitionAllowed('submitted', 'review')).toBe(true));
    it('permits reviewed→accept', () => expect(isTransitionAllowed('reviewed', 'accept')).toBe(true));
    it('permits reviewed→reject', () => expect(isTransitionAllowed('reviewed', 'reject')).toBe(true));
    it('permits rejected→revise', () => expect(isTransitionAllowed('rejected', 'revise')).toBe(true));
    it('permits accepted→renew', () => expect(isTransitionAllowed('accepted', 'renew')).toBe(true));
    it('permits expiring→accept', () => expect(isTransitionAllowed('expiring', 'accept')).toBe(true));
    it('permits any→archive from non-terminal states', () => {
      for (const s of ['draft', 'submitted', 'reviewed', 'accepted', 'expiring', 'expired', 'rejected'] as const) {
        expect(isTransitionAllowed(s, 'archive')).toBe(true);
      }
    });

    it('rejects draft→review (must submit first)', () => {
      expect(isTransitionAllowed('draft', 'review')).toBe(false);
    });
    it('rejects draft→accept', () => expect(isTransitionAllowed('draft', 'accept')).toBe(false));
    it('rejects archived→anything', () => {
      for (const a of ['submit', 'review', 'accept', 'renew', 'archive'] as const) {
        expect(isTransitionAllowed('archived', a)).toBe(false);
      }
    });
    it('rejects accepted→review (already reviewed)', () => {
      expect(isTransitionAllowed('accepted', 'review')).toBe(false);
    });
  });
});

describe('classifyFreshness', () => {
  const leadDays = 30;
  const now = Date.now();

  it('pending for draft/submitted/reviewed', () => {
    expect(classifyFreshness({ status: 'draft', valid_until: null } as any, leadDays, now)).toBe('pending');
    expect(classifyFreshness({ status: 'submitted', valid_until: null } as any, leadDays, now)).toBe('pending');
    expect(classifyFreshness({ status: 'reviewed', valid_until: null } as any, leadDays, now)).toBe('pending');
  });

  it('rejected/archived/expired map directly', () => {
    expect(classifyFreshness({ status: 'rejected', valid_until: null } as any)).toBe('rejected');
    expect(classifyFreshness({ status: 'archived', valid_until: null } as any)).toBe('archived');
    expect(classifyFreshness({ status: 'expired', valid_until: null } as any)).toBe('expired');
  });

  it('accepted without valid_until is fresh', () => {
    expect(classifyFreshness({ status: 'accepted', valid_until: null } as any, leadDays, now)).toBe('fresh');
  });

  it('accepted far from expiry is fresh', () => {
    const until = new Date(now + 180 * 86400_000).toISOString();
    expect(classifyFreshness({ status: 'accepted', valid_until: until } as any, leadDays, now)).toBe('fresh');
  });

  it('accepted within lead window is expiring_soon', () => {
    const until = new Date(now + 10 * 86400_000).toISOString();
    expect(classifyFreshness({ status: 'accepted', valid_until: until } as any, leadDays, now)).toBe('expiring_soon');
  });

  it('accepted past valid_until is expired', () => {
    const until = new Date(now - 1000).toISOString();
    expect(classifyFreshness({ status: 'accepted', valid_until: until } as any, leadDays, now)).toBe('expired');
  });
});

describe('createEvidence + transition lifecycle', () => {
  let db: Database.Database;
  let orgId: string;
  let implId: string;

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    const { controlIds } = seedCatalog(db, 1);
    implId = seedImplementation(db, orgId, controlIds[0], 'implemented');
  });

  it('new evidence starts in draft with a history entry', () => {
    const ev = createEvidence(db, { title: 'MFA screenshot', implementation_id: implId }, ACTOR);
    expect(ev.status).toBe('draft');
    expect(ev.version).toBe(1);

    const hist = getStateHistory(db, ev.id);
    expect(hist).toHaveLength(1);
    expect(hist[0].to_status).toBe('draft');
  });

  it('happy path: draft → submitted → reviewed → accepted', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId, renewal_period_days: 90 }, ACTOR);
    const submitted = transition(db, ev.id, { action: 'submit', actor: ACTOR });
    expect(submitted.status).toBe('submitted');

    const reviewed = transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'rev-1' });
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.reviewer_id).toBe('rev-1');
    expect(reviewed.reviewed_at).toBeTruthy();

    const accepted = transition(db, ev.id, { action: 'accept', actor: ACTOR, reviewer_id: 'rev-1', notes: 'ok' });
    expect(accepted.status).toBe('accepted');
    expect(accepted.valid_from).toBeTruthy();
    expect(accepted.valid_until).toBeTruthy();
    expect(accepted.review_notes).toBe('ok');

    // valid_until ≈ 90 days out
    const diffDays = (new Date(accepted.valid_until!).getTime() - Date.now()) / 86400_000;
    expect(diffDays).toBeGreaterThan(89);
    expect(diffDays).toBeLessThan(91);

    const hist = getStateHistory(db, ev.id);
    expect(hist.map((h) => h.to_status)).toEqual(['draft', 'submitted', 'reviewed', 'accepted']);
  });

  it('rejection flow: reviewed → rejected → draft', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'rev-1' });
    const rejected = transition(db, ev.id, { action: 'reject', actor: ACTOR, reviewer_id: 'rev-1', notes: 'missing hash' });
    expect(rejected.status).toBe('rejected');

    const revised = transition(db, ev.id, { action: 'revise', actor: ACTOR });
    expect(revised.status).toBe('draft');
  });

  it('renew action updates valid_until with new renewal period', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId, renewal_period_days: 30 }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'rev-1' });
    const accepted = transition(db, ev.id, { action: 'accept', actor: ACTOR, reviewer_id: 'rev-1' });
    const firstUntil = accepted.valid_until;

    const renewed = transition(db, ev.id, {
      action: 'renew',
      actor: ACTOR,
      renewal_period_days: 180,
    });
    expect(renewed.status).toBe('accepted');
    expect(renewed.valid_until).not.toBe(firstUntil);

    const diffDays = (new Date(renewed.valid_until!).getTime() - Date.now()) / 86400_000;
    expect(diffDays).toBeGreaterThan(179);
  });

  it('explicit valid_until_override wins', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId, renewal_period_days: 30 }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'rev-1' });
    const accepted = transition(db, ev.id, {
      action: 'accept',
      actor: ACTOR,
      reviewer_id: 'rev-1',
      valid_until_override: '2027-01-01T00:00:00.000Z',
    });
    expect(accepted.valid_until).toBe('2027-01-01T00:00:00.000Z');
  });

  it('invalid transition throws InvalidTransitionError', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId }, ACTOR);
    expect(() => transition(db, ev.id, { action: 'accept', actor: ACTOR, reviewer_id: 'r' }))
      .toThrow(InvalidTransitionError);
  });

  it('review/accept/reject require a reviewer_id', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    expect(() => transition(db, ev.id, { action: 'review', actor: ACTOR }))
      .toThrow(/reviewer_id/);
  });

  it('archive is permitted from non-terminal states', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    const archived = transition(db, ev.id, { action: 'archive', actor: ACTOR });
    expect(archived.status).toBe('archived');

    // archived is terminal
    expect(() => transition(db, archived.id, { action: 'submit', actor: ACTOR }))
      .toThrow(InvalidTransitionError);
  });

  it('version is bumped when previous_version_id is supplied', () => {
    const first = createEvidence(db, { title: 'MFA v1', implementation_id: implId }, ACTOR);
    const second = createEvidence(db, {
      title: 'MFA v2',
      implementation_id: implId,
      previous_version_id: first.id,
    }, ACTOR);
    expect(second.version).toBe(2);
    expect(second.previous_version_id).toBe(first.id);
  });

  it('listEvidence filters by status + expiring window', () => {
    const soon = new Date(Date.now() + 10 * 86400_000).toISOString();
    const far = new Date(Date.now() + 180 * 86400_000).toISOString();
    const a = createEvidence(db, { title: 'a', implementation_id: implId }, ACTOR);
    const b = createEvidence(db, { title: 'b', implementation_id: implId }, ACTOR);
    systemTransition(db, a.id, 'accepted', 'test');
    db.prepare('UPDATE evidence SET valid_until = ? WHERE id = ?').run(soon, a.id);
    systemTransition(db, b.id, 'accepted', 'test');
    db.prepare('UPDATE evidence SET valid_until = ? WHERE id = ?').run(far, b.id);

    const accepted = listEvidence(db, { status: 'accepted' });
    expect(accepted).toHaveLength(2);

    const expiring = listEvidence(db, { expiring_within_days: 30 });
    expect(expiring.map((e) => e.id)).toEqual([a.id]);
  });
});

describe('sweepExpiry', () => {
  let db: Database.Database;
  let orgId: string;
  let implId: string;

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    const { controlIds } = seedCatalog(db, 1);
    implId = seedImplementation(db, orgId, controlIds[0], 'implemented');
  });

  it('transitions past-due accepted to expired and raises a drift alert', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId, renewal_period_days: 30 }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'r' });
    transition(db, ev.id, { action: 'accept', actor: ACTOR, reviewer_id: 'r' });
    // force past due
    const past = new Date(Date.now() - 86400_000).toISOString();
    db.prepare('UPDATE evidence SET valid_until = ? WHERE id = ?').run(past, ev.id);

    const result = sweepExpiry(db);
    expect(result.transitioned_expired).toBe(1);

    const after = getEvidence(db, ev.id);
    expect(after!.status).toBe('expired');

    const alerts = db.prepare(
      `SELECT * FROM drift_alerts WHERE source_entity_type = 'evidence' AND source_entity_id = ?`,
    ).all(ev.id);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('transitions accepted-within-lead-window to expiring', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId, renewal_period_days: 1 }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'r' });
    transition(db, ev.id, { action: 'accept', actor: ACTOR, reviewer_id: 'r' });
    // valid_until is ~1 day from now, well within default 30-day lead

    const result = sweepExpiry(db, 30);
    expect(result.transitioned_expiring).toBe(1);

    const after = getEvidence(db, ev.id);
    expect(after!.status).toBe('expiring');
  });

  it('does not double-transition expired items', () => {
    const ev = createEvidence(db, { title: 'x', implementation_id: implId, renewal_period_days: 30 }, ACTOR);
    transition(db, ev.id, { action: 'submit', actor: ACTOR });
    transition(db, ev.id, { action: 'review', actor: ACTOR, reviewer_id: 'r' });
    transition(db, ev.id, { action: 'accept', actor: ACTOR, reviewer_id: 'r' });
    db.prepare('UPDATE evidence SET valid_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), ev.id);

    sweepExpiry(db);
    sweepExpiry(db);
    const alerts = db.prepare(
      `SELECT COUNT(*) AS c FROM drift_alerts WHERE source_entity_type='evidence' AND source_entity_id = ?`,
    ).get(ev.id) as { c: number };
    // createDriftAlert dedupes on (type, source_entity_type, source_entity_id)
    expect(alerts.c).toBe(1);
  });
});

describe('getFreshnessSummary', () => {
  let db: Database.Database;
  let orgId: string;
  let implId: string;

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    const { controlIds } = seedCatalog(db, 2);
    implId = seedImplementation(db, orgId, controlIds[0], 'implemented');
  });

  it('bucketizes accepted/pending/expired/rejected per catalog', () => {
    const a = createEvidence(db, { title: 'A', implementation_id: implId, renewal_period_days: 365 }, ACTOR);
    transition(db, a.id, { action: 'submit', actor: ACTOR });
    transition(db, a.id, { action: 'review', actor: ACTOR, reviewer_id: 'r' });
    transition(db, a.id, { action: 'accept', actor: ACTOR, reviewer_id: 'r' });

    const b = createEvidence(db, { title: 'B', implementation_id: implId }, ACTOR); // draft

    const c = createEvidence(db, { title: 'C', implementation_id: implId }, ACTOR);
    transition(db, c.id, { action: 'submit', actor: ACTOR });
    transition(db, c.id, { action: 'review', actor: ACTOR, reviewer_id: 'r' });
    transition(db, c.id, { action: 'reject', actor: ACTOR, reviewer_id: 'r' });

    const summary = getFreshnessSummary(db);
    expect(summary.overall.fresh).toBe(1);
    expect(summary.overall.pending).toBe(1);
    expect(summary.overall.rejected).toBe(1);
    expect(summary.by_catalog[0].controls_with_evidence).toBe(1);
    // 2 controls total in the catalog, 1 has evidence
    expect(summary.by_catalog[0].total_controls).toBe(2);
    expect(summary.by_catalog[0].controls_missing_evidence).toBe(1);
  });
});
