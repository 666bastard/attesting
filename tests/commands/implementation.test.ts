/**
 * Tests for implementation commands: add, import, list, edit, status.
 *
 * Uses an in-memory SQLite DB — never touches ~/.attesting/attesting.db.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import Database from 'better-sqlite3';
import { generateUuid } from '../../src/utils/uuid.js';
import { calculateCoverage } from '../../src/mappers/coverage.js';

const SCHEMA_PATH = path.join(__dirname, '../../src/db/schema.sql');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  return db;
}

const t = () => new Date().toISOString();

interface SeedResult {
  orgId: string;
  scopeId: string;
  catalogId: string;
  controls: { id: string; nativeId: string }[];
}

function seedDb(db: Database.Database): SeedResult {
  const orgId = generateUuid();
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, 'Test Org', ?, ?)`
  ).run(orgId, t(), t());

  const scopeId = generateUuid();
  db.prepare(
    `INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at) VALUES (?, ?, 'On-Prem', 'product', ?, ?)`
  ).run(scopeId, orgId, t(), t());

  const catalogId = generateUuid();
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at) VALUES (?, 'Test FW', 'test-fw', 'csv', ?, ?)`
  ).run(catalogId, t(), t());

  const insertCtl = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)`
  );

  const controls: { id: string; nativeId: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const id = generateUuid();
    const nativeId = `CTL-00${i}`;
    insertCtl.run(id, catalogId, nativeId, `Control ${i}`, i, t());
    controls.push({ id, nativeId });
  }

  return { orgId, scopeId, catalogId, controls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('implementation add (direct DB)', () => {
  let db: Database.Database;
  let seed: SeedResult;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
  });

  it('inserts a new implementation record', () => {
    const { orgId, scopeId, controls } = seed;
    const implId = generateUuid();
    const now = t();

    db.prepare(
      `INSERT INTO implementations
         (id, org_id, scope_id, primary_control_id, status, statement,
          responsibility_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'implemented', 'We have a policy.', 'provider', ?, ?)`
    ).run(implId, orgId, scopeId, controls[0].id, now, now);

    const row = db
      .prepare('SELECT id, status, statement FROM implementations WHERE id = ?')
      .get(implId) as { id: string; status: string; statement: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.status).toBe('implemented');
    expect(row!.statement).toBe('We have a policy.');
  });
});

describe('implementation import (CSV parsing)', () => {
  let db: Database.Database;
  let seed: SeedResult;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
  });

  it('inserts multiple implementations from CSV-parsed data', () => {
    const { orgId, scopeId, controls } = seed;

    // Simulate what the import command does row-by-row
    const insertImpl = db.prepare(
      `INSERT INTO implementations
         (id, org_id, scope_id, primary_control_id, status, statement,
          responsibility_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'provider', ?, ?)`
    );

    const rows = [
      { ctl: controls[0], status: 'implemented', stmt: 'Access is controlled via LDAP.' },
      { ctl: controls[1], status: 'partially-implemented', stmt: 'Partial logging in place.' },
      { ctl: controls[2], status: 'not-implemented', stmt: 'Not yet addressed.' },
    ];

    const runAll = db.transaction(() => {
      for (const r of rows) {
        insertImpl.run(generateUuid(), orgId, scopeId, r.ctl.id, r.status, r.stmt, t(), t());
      }
    });
    runAll();

    const count = (
      db.prepare('SELECT COUNT(*) AS cnt FROM implementations WHERE org_id = ?').get(orgId) as {
        cnt: number;
      }
    ).cnt;
    expect(count).toBe(3);
  });
});

describe('implementation list', () => {
  let db: Database.Database;
  let seed: SeedResult;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
  });

  it('returns all implementations for an org', () => {
    const { orgId, scopeId, controls } = seed;

    for (const ctl of controls) {
      db.prepare(
        `INSERT INTO implementations
           (id, org_id, scope_id, primary_control_id, status, statement,
            responsibility_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'implemented', 'Statement text.', 'provider', ?, ?)`
      ).run(generateUuid(), orgId, scopeId, ctl.id, t(), t());
    }

    const rows = db
      .prepare(
        `SELECT i.id FROM implementations i WHERE i.org_id = ?`
      )
      .all(orgId);

    expect(rows).toHaveLength(3);
  });
});

describe('implementation edit', () => {
  let db: Database.Database;
  let seed: SeedResult;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
  });

  it('updates the status of an existing implementation', () => {
    const { orgId, scopeId, controls } = seed;
    const implId = generateUuid();

    db.prepare(
      `INSERT INTO implementations
         (id, org_id, scope_id, primary_control_id, status, statement,
          responsibility_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'not-implemented', 'Initial statement.', 'provider', ?, ?)`
    ).run(implId, orgId, scopeId, controls[0].id, t(), t());

    // Edit: update status
    db.prepare(
      `UPDATE implementations SET status = 'implemented', updated_at = ? WHERE id = ?`
    ).run(t(), implId);

    const updated = db
      .prepare('SELECT status FROM implementations WHERE id = ?')
      .get(implId) as { status: string };

    expect(updated.status).toBe('implemented');
  });

  it('updates the statement of an existing implementation', () => {
    const { orgId, scopeId, controls } = seed;
    const implId = generateUuid();

    db.prepare(
      `INSERT INTO implementations
         (id, org_id, scope_id, primary_control_id, status, statement,
          responsibility_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'implemented', 'Original statement.', 'provider', ?, ?)`
    ).run(implId, orgId, scopeId, controls[0].id, t(), t());

    db.prepare(
      `UPDATE implementations SET statement = 'Updated statement.', updated_at = ? WHERE id = ?`
    ).run(t(), implId);

    const updated = db
      .prepare('SELECT statement FROM implementations WHERE id = ?')
      .get(implId) as { statement: string };

    expect(updated.statement).toBe('Updated statement.');
  });
});

describe('implementation status (calculateCoverage)', () => {
  let db: Database.Database;
  let seed: SeedResult;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
  });

  it('returns 0% coverage when no implementations exist', () => {
    const { orgId } = seed;
    const results = calculateCoverage(orgId, null, db);

    // Catalog is present but has no implementations
    expect(results).toHaveLength(1);
    expect(results[0].coveragePct).toBe(0);
    expect(results[0].implemented).toBe(0);
  });

  it('calculates correct coverage % after adding implementations', () => {
    const { orgId, scopeId, controls } = seed;

    // Implement 2 of 3 controls
    for (const ctl of controls.slice(0, 2)) {
      db.prepare(
        `INSERT INTO implementations
           (id, org_id, scope_id, primary_control_id, status, statement,
            responsibility_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'implemented', 'Done.', 'provider', ?, ?)`
      ).run(generateUuid(), orgId, scopeId, ctl.id, t(), t());
    }

    const results = calculateCoverage(orgId, scopeId, db);

    expect(results).toHaveLength(1);
    expect(results[0].totalControls).toBe(3);
    expect(results[0].implemented).toBe(2);
    // 2/3 * 100 = 66.7%
    expect(results[0].coveragePct).toBeCloseTo(66.7, 0);
  });

  it('counts not-applicable controls in coverage %', () => {
    const { orgId, scopeId, controls } = seed;

    db.prepare(
      `INSERT INTO implementations
         (id, org_id, scope_id, primary_control_id, status, statement,
          responsibility_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'not-applicable', 'N/A for this scope.', 'provider', ?, ?)`
    ).run(generateUuid(), orgId, scopeId, controls[0].id, t(), t());

    const results = calculateCoverage(orgId, scopeId, db);

    // not-applicable counts toward coverage
    expect(results[0].notApplicable).toBe(1);
    expect(results[0].coveragePct).toBeGreaterThan(0);
  });
});
