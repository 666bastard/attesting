import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { importBundledCatalog, importBundledCatalogs, listBundledCatalogs } from '../../../src/services/onboarding/catalog-bundle.js';
import * as connection from '../../../src/db/connection.js';

const SCHEMA_PATH = path.join(__dirname, '../../../src/db/schema.sql');

function openTestDb(): Database.Database {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(sql);
  return db;
}

describe('importBundledCatalog', () => {
  let testDb: Database.Database;
  let originalGetDb: () => Database.Database;

  beforeEach(() => {
    testDb = openTestDb();
    originalGetDb = connection.db.getDb.bind(connection.db);
    connection.db.getDb = () => testDb;
  });

  afterEach(() => {
    connection.db.getDb = originalGetDb;
    testDb.close();
  });

  it('imports a bundled OSCAL catalog and creates control rows', () => {
    const result = importBundledCatalog(testDb, 'nist-csf-2.0');
    expect(result.status).toBe('imported');
    expect(result.controlCount).toBeGreaterThan(0);

    const row = testDb.prepare('SELECT total_controls FROM catalogs WHERE short_name = ?').get('nist-csf-2.0') as any;
    expect(row.total_controls).toBe(result.controlCount);

    const ctlCount = (testDb.prepare('SELECT COUNT(*) AS c FROM controls').get() as any).c;
    expect(ctlCount).toBe(result.controlCount);
  });

  it('imports a bundled headerless CSV catalog without dropping the first row', () => {
    const result = importBundledCatalog(testDb, 'soc2-tsc');
    expect(result.status).toBe('imported');

    // First control in the CSV is CC1.1 — confirm the header-skipping path doesn't lose it
    const first = testDb
      .prepare("SELECT control_id FROM controls WHERE control_id = 'CC1.1'")
      .get();
    expect(first).toBeDefined();
  });

  it('is idempotent — re-importing returns skipped', () => {
    const first = importBundledCatalog(testDb, 'soc2-tsc');
    expect(first.status).toBe('imported');
    const second = importBundledCatalog(testDb, 'soc2-tsc');
    expect(second.status).toBe('skipped');
  });

  it('returns unknown for shortNames not in the bundle index', () => {
    const result = importBundledCatalog(testDb, 'iso-27001-2022');
    expect(result.status).toBe('unknown');
  });
});

describe('importBundledCatalogs', () => {
  let testDb: Database.Database;
  let originalGetDb: () => Database.Database;

  beforeEach(() => {
    testDb = openTestDb();
    originalGetDb = connection.db.getDb.bind(connection.db);
    connection.db.getDb = () => testDb;
  });

  afterEach(() => {
    connection.db.getDb = originalGetDb;
    testDb.close();
  });

  it('imports each shortName in order and reports per-catalog status', () => {
    const results = importBundledCatalogs(testDb, ['nist-csf-2.0', 'soc2-tsc', 'unknown-fw']);
    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('imported');
    expect(results[1].status).toBe('imported');
    expect(results[2].status).toBe('unknown');
  });
});

describe('listBundledCatalogs', () => {
  it('returns all bundled framework shortNames', () => {
    const list = listBundledCatalogs();
    expect(list).toContain('nist-csf-2.0');
    expect(list).toContain('soc2-tsc');
    expect(list).toContain('cmmc-2.0');
  });
});
