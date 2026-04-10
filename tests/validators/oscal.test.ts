/**
 * Tests for the OSCAL validator and FedRAMP-compliant SSP export.
 *
 * Tests that:
 * 1. The validator catches structural and business rule violations
 * 2. The Attesting SSP export passes all validation rules by default
 * 3. Rule IDs match the Python oscal_validator.py reference (STRUCT-001 through SSP-033)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { generateUuid } from '../../src/utils/uuid.js';
import { exportOscalSsp, exportOscalComponentDefinition } from '../../src/exporters/oscal-json.js';
import { validateOscalDocument, validateOscalFile } from '../../src/validators/oscal.js';

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

function seedDb(db: Database.Database) {
  const orgId = generateUuid();
  db.prepare(
    `INSERT INTO organizations (id, name, description, created_at, updated_at) VALUES (?, 'Acme Corp', 'Test org', ?, ?)`
  ).run(orgId, t(), t());

  const scopeId = generateUuid();
  db.prepare(
    `INSERT INTO scopes (id, org_id, name, description, scope_type, created_at, updated_at)
     VALUES (?, ?, 'Production', 'Production environment', 'product', ?, ?)`
  ).run(scopeId, orgId, t(), t());

  const catId = generateUuid();
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, total_controls, created_at, updated_at)
     VALUES (?, 'NIST 800-53', 'nist-800-53', 'oscal', 3, ?, ?)`
  ).run(catId, t(), t());

  const controls: string[] = [];
  const insertCtl = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, description, metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
  );

  for (let i = 1; i <= 3; i++) {
    const id = generateUuid();
    insertCtl.run(id, catId, `AC-${i}`, `Access Control ${i}`, `Description for AC-${i}`, i, t());
    controls.push(id);
  }

  // Add implementations
  const insertImpl = db.prepare(
    `INSERT INTO implementations (id, org_id, scope_id, primary_control_id, status, statement,
      responsible_role, responsibility_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'provider', ?, ?)`
  );

  insertImpl.run(generateUuid(), orgId, scopeId, controls[0], 'implemented', 'SSO is deployed for all access.', 'Security Engineer', t(), t());
  insertImpl.run(generateUuid(), orgId, scopeId, controls[1], 'partially-implemented', 'MFA is being rolled out.', 'IT Admin', t(), t());
  insertImpl.run(generateUuid(), orgId, scopeId, controls[2], 'not-applicable', 'Not applicable to SaaS.', null, t(), t());

  return { orgId, scopeId, catId, controls };
}

// ---------------------------------------------------------------------------
// Validator unit tests — structural rules
// ---------------------------------------------------------------------------

describe('OSCAL Validator — Structural rules', () => {
  it('STRUCT-001: rejects unknown document type', () => {
    const result = validateOscalDocument({}, 'unknown-type' as any);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.rule === 'STRUCT-001')).toBe(true);
  });

  it('STRUCT-002: rejects missing root element', () => {
    const result = validateOscalDocument({ foo: 'bar' }, 'ssp');
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.rule === 'STRUCT-002')).toBe(true);
  });

  it('STRUCT-003: rejects missing uuid on root', () => {
    const result = validateOscalDocument({
      'system-security-plan': { metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' } }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'STRUCT-003')).toBe(true);
  });

  it('STRUCT-004: rejects missing metadata', () => {
    const result = validateOscalDocument({
      'system-security-plan': { uuid: generateUuid() }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'STRUCT-004')).toBe(true);
  });
});

describe('OSCAL Validator — Metadata rules', () => {
  it('META-001: rejects missing title', () => {
    const result = validateOscalDocument({
      'system-security-plan': { uuid: generateUuid(), metadata: { 'last-modified': t() } }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'META-001')).toBe(true);
  });

  it('META-002: rejects missing last-modified', () => {
    const result = validateOscalDocument({
      'system-security-plan': { uuid: generateUuid(), metadata: { title: 'Test' } }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'META-002')).toBe(true);
  });

  it('META-003: warns on missing version', () => {
    const result = validateOscalDocument({
      'system-security-plan': { uuid: generateUuid(), metadata: { title: 'Test', 'last-modified': t(), 'oscal-version': '1.1.2' } }
    }, 'ssp');
    expect(result.warnings.some((w) => w.rule === 'META-003')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validator unit tests — SSP rules
// ---------------------------------------------------------------------------

describe('OSCAL Validator — SSP rules', () => {
  it('SSP-001: rejects missing system-characteristics', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
      }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'SSP-001')).toBe(true);
  });

  it('SSP-004: rejects missing security-sensitivity-level', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
        'system-characteristics': {
          'system-name': 'Test System',
          description: 'A test',
          'authorization-boundary': { description: 'boundary' },
        },
      }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'SSP-004')).toBe(true);
  });

  it('SSP-005: rejects missing authorization boundary description', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
        'system-characteristics': {
          'system-name': 'Test System',
          description: 'A test',
          'security-sensitivity-level': 'fips-199-moderate',
          'authorization-boundary': {},
        },
      }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'SSP-005')).toBe(true);
  });

  it('SSP-006: rejects missing security impact level dimensions', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
        'system-characteristics': {
          'system-name': 'Test System',
          description: 'A test',
          'security-sensitivity-level': 'fips-199-moderate',
          'authorization-boundary': { description: 'boundary' },
          'security-impact-level': {},
        },
      }
    }, 'ssp');
    const ssp006 = result.errors.filter((e) => e.rule === 'SSP-006');
    expect(ssp006.length).toBe(3); // confidentiality, integrity, availability
  });

  it('SSP-010: rejects missing system-implementation', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
        'system-characteristics': {
          'system-name': 'Test',
          'security-sensitivity-level': 'fips-199-moderate',
          'security-impact-level': {
            'security-objective-confidentiality': 'moderate',
            'security-objective-integrity': 'moderate',
            'security-objective-availability': 'moderate',
          },
          'authorization-boundary': { description: 'boundary' },
        },
      }
    }, 'ssp');
    expect(result.errors.some((e) => e.rule === 'SSP-010')).toBe(true);
  });

  it('SSP-012: warns when no this-system component', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
        'system-characteristics': {
          'system-name': 'Test',
          'security-sensitivity-level': 'fips-199-moderate',
          'security-impact-level': {
            'security-objective-confidentiality': 'moderate',
            'security-objective-integrity': 'moderate',
            'security-objective-availability': 'moderate',
          },
          'authorization-boundary': { description: 'boundary' },
        },
        'system-implementation': {
          components: [{ uuid: generateUuid(), type: 'software', title: 'App' }],
        },
        'control-implementation': {
          'implemented-requirements': [{ uuid: generateUuid(), 'control-id': 'AC-1', props: [{ name: 'implementation-status', value: 'implemented' }], 'by-components': [{ 'component-uuid': 'x', description: 'done' }] }],
        },
      }
    }, 'ssp');
    expect(result.warnings.some((w) => w.rule === 'SSP-012')).toBe(true);
  });

  it('SSP-025: warns when no implementation-status prop', () => {
    const result = validateOscalDocument({
      'system-security-plan': {
        uuid: generateUuid(),
        metadata: { title: 'Test', 'last-modified': t(), version: '1.0', 'oscal-version': '1.1.2' },
        'system-characteristics': {
          'system-name': 'Test',
          'security-sensitivity-level': 'fips-199-moderate',
          'security-impact-level': {
            'security-objective-confidentiality': 'moderate',
            'security-objective-integrity': 'moderate',
            'security-objective-availability': 'moderate',
          },
          'authorization-boundary': { description: 'boundary' },
        },
        'system-implementation': {
          components: [{ uuid: generateUuid(), type: 'this-system', title: 'System' }],
        },
        'control-implementation': {
          'implemented-requirements': [{ uuid: generateUuid(), 'control-id': 'AC-1', props: [] }],
        },
      }
    }, 'ssp');
    expect(result.warnings.some((w) => w.rule === 'SSP-025')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration test: export SSP then validate it
// ---------------------------------------------------------------------------

describe('OSCAL SSP export passes FedRAMP validation', () => {
  let db: Database.Database;
  let tmpFile: string;

  beforeEach(() => {
    db = createTestDb();
    seedDb(db);
    tmpFile = path.join(os.tmpdir(), `oscal-validate-test-${Date.now()}.json`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('exported SSP passes all structural validation rules (zero errors)', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const result = validateOscalFile(tmpFile, 'ssp');

    // Log findings for debugging if any errors
    if (!result.passed) {
      console.log('VALIDATION ERRORS:');
      for (const e of result.errors) {
        console.log(`  ${e.rule}: ${e.message}`);
      }
    }

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('exported SSP has uuid on root', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    expect(doc['system-security-plan'].uuid).toBeDefined();
  });

  it('exported SSP has all required metadata fields', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const meta = doc['system-security-plan'].metadata;
    expect(meta.title).toBeTruthy();
    expect(meta['last-modified']).toBeTruthy();
    expect(meta.version).toBeTruthy();
    expect(meta['oscal-version']).toBe('1.1.2');
  });

  it('exported SSP has security-sensitivity-level', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const chars = doc['system-security-plan']['system-characteristics'];
    expect(chars['security-sensitivity-level']).toBe('fips-199-moderate');
  });

  it('exported SSP has all three security-impact-level dimensions', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const impact = doc['system-security-plan']['system-characteristics']['security-impact-level'];
    expect(impact['security-objective-confidentiality']).toBeTruthy();
    expect(impact['security-objective-integrity']).toBeTruthy();
    expect(impact['security-objective-availability']).toBeTruthy();
  });

  it('exported SSP has authorization-boundary with description', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const boundary = doc['system-security-plan']['system-characteristics']['authorization-boundary'];
    expect(boundary.description).toBeTruthy();
  });

  it('exported SSP has this-system component', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const components = doc['system-security-plan']['system-implementation'].components;
    expect(components.some((c: any) => c.type === 'this-system')).toBe(true);
  });

  it('every implemented-requirement has implementation-status prop', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const reqs = doc['system-security-plan']['control-implementation']['implemented-requirements'];
    for (const req of reqs) {
      const statusProp = req.props?.find((p: any) => p.name === 'implementation-status');
      expect(statusProp).toBeDefined();
      expect(['implemented', 'partial', 'planned', 'alternative', 'not-applicable']).toContain(statusProp.value);
    }
  });

  it('every implemented-requirement has by-components referencing the this-system UUID', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
    const components = doc['system-security-plan']['system-implementation'].components;
    const thisSystemUuid = components.find((c: any) => c.type === 'this-system')?.uuid;
    expect(thisSystemUuid).toBeDefined();

    const reqs = doc['system-security-plan']['control-implementation']['implemented-requirements'];
    for (const req of reqs) {
      expect(req['by-components']).toBeDefined();
      expect(req['by-components'].length).toBeGreaterThan(0);
      expect(req['by-components'][0]['component-uuid']).toBe(thisSystemUuid);
    }
  });

  it('exported SSP passes validation even in strict mode (no warnings that matter)', () => {
    exportOscalSsp('Production', [], tmpFile, db);
    const result = validateOscalFile(tmpFile, 'ssp', { strict: true });
    // In strict mode, we still pass since our export produces clean output
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Component Definition validation
// ---------------------------------------------------------------------------

describe('OSCAL Component Definition validation', () => {
  let db: Database.Database;
  let tmpFile: string;

  beforeEach(() => {
    db = createTestDb();
    seedDb(db);
    tmpFile = path.join(os.tmpdir(), `oscal-cd-validate-${Date.now()}.json`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('exported Component Definition passes structural validation', () => {
    exportOscalComponentDefinition('Production', [], tmpFile, db);
    const result = validateOscalFile(tmpFile, 'component-definition');
    expect(result.passed).toBe(true);
  });
});
