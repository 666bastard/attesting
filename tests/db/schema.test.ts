import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

/**
 * Opens a fresh in-memory (or temp-file) database and applies the schema.
 * This tests the schema in isolation without touching ~/.attesting/attesting.db.
 */
function openTestDb(): Database.Database {
  const schemaPath = path.join(__dirname, '../../src/db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(sql);
  return db;
}

describe('Database Schema', () => {
  let db: Database.Database;

  it('initializes without error', () => {
    expect(() => {
      db = openTestDb();
    }).not.toThrow();
  });

  it('creates all expected tables', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('organizations');
    expect(tableNames).toContain('scopes');
    expect(tableNames).toContain('catalogs');
    expect(tableNames).toContain('controls');
    expect(tableNames).toContain('control_mappings');
    expect(tableNames).toContain('implementations');
    expect(tableNames).toContain('assessments');
    expect(tableNames).toContain('assessment_results');
    expect(tableNames).toContain('evidence');
    expect(tableNames).toContain('poam_items');
  });

  it('creates the FTS5 virtual table (controls_fts)', () => {
    // FTS5 tables appear in sqlite_master with type 'table' but also have
    // shadow tables; the simplest check is querying the virtual table itself.
    expect(() => {
      db.prepare('SELECT * FROM controls_fts LIMIT 0').run();
    }).not.toThrow();
  });

  it('can insert and retrieve an organization', () => {
    const id = 'test-org-uuid-001';
    db.prepare(
      `INSERT INTO organizations (id, name, description, cage_code)
       VALUES (?, ?, ?, ?)`
    ).run(id, 'Test Corp', 'A test organization', '1ABCD');

    const org = db
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(id) as { id: string; name: string; cage_code: string } | undefined;

    expect(org).toBeDefined();
    expect(org!.name).toBe('Test Corp');
    expect(org!.cage_code).toBe('1ABCD');
  });

  it('can insert and retrieve a scope', () => {
    // org must already exist (created by prior test)
    const orgId = 'test-org-uuid-001';
    const scopeId = 'test-scope-uuid-001';

    db.prepare(
      `INSERT INTO scopes (id, org_id, name, scope_type)
       VALUES (?, ?, ?, ?)`
    ).run(scopeId, orgId, 'Cloud Platform', 'system');

    const scope = db
      .prepare('SELECT * FROM scopes WHERE id = ?')
      .get(scopeId) as { id: string; name: string; scope_type: string } | undefined;

    expect(scope).toBeDefined();
    expect(scope!.name).toBe('Cloud Platform');
    expect(scope!.scope_type).toBe('system');
  });

  afterAll(() => {
    if (db) db.close();
  });
});
