/**
 * Tests for the OSCAL JSON exporter.
 *
 * Uses an in-memory SQLite database — never touches ~/.attesting/attesting.db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { generateUuid } from '../../src/utils/uuid.js';
import {
  exportOscalComponentDefinition,
  exportOscalSsp,
} from '../../src/exporters/oscal-json.js';

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
  catalogs: { id: string; shortName: string }[];
  controls: { id: string; nativeId: string; catalogShortName: string }[];
}

function seedDb(db: Database.Database): SeedResult {
  const orgId = generateUuid();
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, 'Acme Corp', ?, ?)`
  ).run(orgId, t(), t());

  const scopeId = generateUuid();
  db.prepare(
    `INSERT INTO scopes (id, org_id, name, description, scope_type, created_at, updated_at)
     VALUES (?, ?, 'On-Prem', 'On-premises deployment', 'product', ?, ?)`
  ).run(scopeId, orgId, t(), t());

  // Two catalogs
  const catalogs: { id: string; shortName: string }[] = [];
  const catalogDefs = [
    { name: 'NIST 800-171', shortName: 'nist-800-171' },
    { name: 'ISO 27001', shortName: 'iso-27001' },
  ];

  for (const def of catalogDefs) {
    const id = generateUuid();
    db.prepare(
      `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at)
       VALUES (?, ?, ?, 'csv', ?, ?)`
    ).run(id, def.name, def.shortName, t(), t());
    catalogs.push({ id, shortName: def.shortName });
  }

  // 2 controls per catalog = 4 total
  const controls: { id: string; nativeId: string; catalogShortName: string }[] = [];
  const insertCtl = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)`
  );

  catalogs.forEach((cat, catIdx) => {
    for (let i = 1; i <= 2; i++) {
      const id = generateUuid();
      const nativeId = `CTL-${catIdx + 1}.${i}`;
      insertCtl.run(id, cat.id, nativeId, `Control ${nativeId}`, catIdx * 2 + i, t());
      controls.push({ id, nativeId, catalogShortName: cat.shortName });
    }
  });

  return { orgId, scopeId, catalogs, controls };
}

function addImplementations(
  db: Database.Database,
  orgId: string,
  scopeId: string,
  controls: { id: string; nativeId: string; catalogShortName: string }[]
): void {
  const insert = db.prepare(
    `INSERT INTO implementations
       (id, org_id, scope_id, primary_control_id, status, statement,
        responsible_role, responsibility_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'provider', ?, ?)`
  );

  // 3 implementations (covering 3 of 4 controls)
  const statuses = ['implemented', 'partially-implemented', 'not-applicable'];
  for (let i = 0; i < 3; i++) {
    insert.run(
      generateUuid(), orgId, scopeId, controls[i].id,
      statuses[i],
      `Statement for ${controls[i].nativeId}`,
      'IT Security',
      t(), t()
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OSCAL JSON Exporter — Component Definition', () => {
  let db: Database.Database;
  let seed: SeedResult;
  let tmpFile: string;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
    addImplementations(db, seed.orgId, seed.scopeId, seed.controls);
    tmpFile = path.join(os.tmpdir(), `oscal-cd-test-${Date.now()}.json`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('writes a file to disk', () => {
    exportOscalComponentDefinition('On-Prem', [], tmpFile, db);
    expect(fs.existsSync(tmpFile)).toBe(true);
  });

  it('output is valid JSON', () => {
    exportOscalComponentDefinition('On-Prem', [], tmpFile, db);
    const raw = fs.readFileSync(tmpFile, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('top-level key is "component-definition"', () => {
    exportOscalComponentDefinition('On-Prem', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    expect(doc).toHaveProperty('component-definition');
  });

  it('oscal-version is "1.1.2"', () => {
    exportOscalComponentDefinition('On-Prem', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    expect(doc['component-definition'].metadata['oscal-version']).toBe('1.1.2');
  });

  it('implemented-requirements count matches implementations in DB', () => {
    exportOscalComponentDefinition('On-Prem', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));

    const component = doc['component-definition'].components[0];
    const totalImpls = component['control-implementations'].reduce(
      (sum: number, ci: { 'implemented-requirements': unknown[] }) =>
        sum + ci['implemented-requirements'].length,
      0
    );

    // We inserted 3 implementations
    expect(totalImpls).toBe(3);
  });

  it('filters by catalog short name when provided', () => {
    exportOscalComponentDefinition('On-Prem', ['nist-800-171'], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const component = doc['component-definition'].components[0];

    // Only NIST controls should appear
    expect(component['control-implementations']).toHaveLength(1);
    expect(component['control-implementations'][0].description).toContain('NIST');
  });
});

describe('OSCAL JSON Exporter — SSP', () => {
  let db: Database.Database;
  let seed: SeedResult;
  let tmpFile: string;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
    addImplementations(db, seed.orgId, seed.scopeId, seed.controls);
    tmpFile = path.join(os.tmpdir(), `oscal-ssp-test-${Date.now()}.json`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('writes a file to disk', () => {
    exportOscalSsp('On-Prem', [], tmpFile, db);
    expect(fs.existsSync(tmpFile)).toBe(true);
  });

  it('top-level key is "system-security-plan"', () => {
    exportOscalSsp('On-Prem', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    expect(doc).toHaveProperty('system-security-plan');
  });

  it('oscal-version is "1.1.2"', () => {
    exportOscalSsp('On-Prem', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    expect(doc['system-security-plan'].metadata['oscal-version']).toBe('1.1.2');
  });

  it('implemented-requirements count matches implementations', () => {
    exportOscalSsp('On-Prem', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const reqs =
      doc['system-security-plan']['control-implementation'][
        'implemented-requirements'
      ];
    expect(reqs).toHaveLength(3);
  });
});
