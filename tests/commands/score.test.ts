/**
 * CLI tests for the `attesting score` command group.
 *
 * These exercise the underlying service + database layer the CLI commands
 * delegate to. A full end-to-end Commander invocation isn't worthwhile here
 * because each register*() function is a thin wrapper around the service
 * calls already validated in compliance-score.test.ts.
 *
 * Instead we cover the `_common` helpers (catalog/scope resolution,
 * score formatting) that the CLI relies on and verify they behave correctly
 * against an in-memory database.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
  seedImplementation,
} from '../helpers/test-db.js';
import { generateUuid } from '../../src/utils/uuid.js';
import { resolveCatalog, resolveScope, fmtScore } from '../../src/commands/score/_common.js';
import { snapshotScore } from '../../src/services/scoring/snapshot.js';

describe('score CLI _common helpers', () => {
  let db: Database.Database;
  let catId: string;

  beforeEach(() => {
    db = createTestDb();
    seedOrg(db);
    ({ catId } = seedCatalog(db, 2));
  });

  describe('resolveCatalog', () => {
    it('resolves by short_name', () => {
      const c = resolveCatalog(db, 'test-fw');
      expect(c.id).toBe(catId);
      expect(c.short_name).toBe('test-fw');
    });

    it('resolves by UUID', () => {
      const c = resolveCatalog(db, catId);
      expect(c.id).toBe(catId);
    });

    it('exits on unknown catalog', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('__exit__');
      }) as any);
      expect(() => resolveCatalog(db, 'nope')).toThrow('__exit__');
      exitSpy.mockRestore();
    });
  });

  describe('resolveScope', () => {
    it('returns null for undefined', () => {
      expect(resolveScope(db, undefined)).toBeNull();
    });

    it('returns null for "org" literal', () => {
      expect(resolveScope(db, 'org')).toBeNull();
    });

    it('resolves a scope by name', () => {
      const { orgId } = seedOrg(db);
      const scopeId = generateUuid();
      db.prepare(
        `INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at)
         VALUES (?, ?, 'prod', 'product', datetime('now'), datetime('now'))`,
      ).run(scopeId, orgId);

      expect(resolveScope(db, 'prod')).toBe(scopeId);
    });

    it('exits on unknown scope', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('__exit__');
      }) as any);
      expect(() => resolveScope(db, 'nope')).toThrow('__exit__');
      exitSpy.mockRestore();
    });
  });

  describe('fmtScore', () => {
    it('formats numeric scores as percentages', () => {
      expect(fmtScore(42.5)).toBe('42.50%');
      expect(fmtScore(100)).toBe('100.00%');
      expect(fmtScore(0)).toBe('0.00%');
    });

    it('returns n/a for null/undefined', () => {
      expect(fmtScore(null)).toBe('n/a');
      expect(fmtScore(undefined)).toBe('n/a');
    });
  });
});

describe('score CLI workflow integration', () => {
  let db: Database.Database;
  let orgId: string;
  let catId: string;
  let controlIds: string[];

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    ({ catId, controlIds } = seedCatalog(db, 4));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('snapshot → show → history round-trip', () => {
    seedImplementation(db, orgId, controlIds[0], 'implemented');

    // snapshot
    const snap = snapshotScore(db, catId);
    expect(snap.overall_score).toBeGreaterThan(0);

    // latest row readable
    const latest = db
      .prepare('SELECT * FROM compliance_scores WHERE catalog_id = ?')
      .get(catId) as any;
    expect(latest).toBeDefined();
    expect(latest.overall_score).toBe(snap.overall_score);

    // history row written
    const hist = db
      .prepare('SELECT * FROM compliance_score_history WHERE catalog_id = ?')
      .all(catId) as any[];
    expect(hist.length).toBe(1);
    expect(hist[0].trigger).toBe('manual');
  });

  it('improving coverage raises overall_score between snapshots', () => {
    seedImplementation(db, orgId, controlIds[0], 'implemented');
    const s1 = snapshotScore(db, catId);

    seedImplementation(db, orgId, controlIds[1], 'implemented');
    seedImplementation(db, orgId, controlIds[2], 'implemented');
    const s2 = snapshotScore(db, catId);

    expect(s2.overall_score).toBeGreaterThan(s1.overall_score);
  });
});
