#!/usr/bin/env npx tsx
/**
 * CI script: OSCAL Export Pipeline Validation
 *
 * Creates a test database in-memory, imports a small catalog, adds
 * implementations, exports an OSCAL SSP, then validates it against
 * the built-in FedRAMP rules. Exits 1 if any STRUCT or SSP errors.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { exportOscalSsp } from '../src/exporters/oscal-json.js';
import { validateOscalFile } from '../src/validators/oscal.js';

// ESM-compatible __dirname shim (package is "type": "module" since Phase 5I)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_PATH = path.join(__dirname, '../src/db/schema.sql');

function main() {
  console.log('OSCAL Export Pipeline Validation');
  console.log('================================\n');

  // Create in-memory database
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  const t = () => new Date().toISOString();

  // Step 1: Create org and scope
  const orgId = uuid();
  db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(orgId, 'CI Test Org', t(), t());

  const scopeId = uuid();
  db.prepare('INSERT INTO scopes (id, org_id, name, description, scope_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(scopeId, orgId, 'CI-Scope', 'CI validation scope', 'product', t(), t());

  console.log('  [1/5] Created org and scope');

  // Step 2: Import test catalog
  const catId = uuid();
  db.prepare('INSERT INTO catalogs (id, name, short_name, source_format, total_controls, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(catId, 'CI Test Framework', 'ci-test-fw', 'csv', 5, t(), t());

  const insertCtl = db.prepare(
    'INSERT INTO controls (id, catalog_id, control_id, title, description, metadata, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const controlIds: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const id = uuid();
    insertCtl.run(id, catId, `AC-${i}`, `Access Control ${i}`, `Description for control AC-${i}`, '{}', i, t());
    controlIds.push(id);
  }

  console.log('  [2/5] Imported 5 test controls');

  // Step 3: Add implementations
  const insertImpl = db.prepare(
    'INSERT INTO implementations (id, org_id, scope_id, primary_control_id, status, statement, responsible_role, responsibility_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  insertImpl.run(uuid(), orgId, scopeId, controlIds[0], 'implemented', 'SSO deployed.', 'Security Eng', 'provider', t(), t());
  insertImpl.run(uuid(), orgId, scopeId, controlIds[1], 'partially-implemented', 'MFA rollout in progress.', 'IT Admin', 'provider', t(), t());
  insertImpl.run(uuid(), orgId, scopeId, controlIds[2], 'not-applicable', 'Not applicable.', null, 'provider', t(), t());

  console.log('  [3/5] Added 3 implementations');

  // Step 4: Export OSCAL SSP
  const tmpFile = path.join(os.tmpdir(), `ci-oscal-validate-${Date.now()}.json`);
  const exportResult = exportOscalSsp('CI-Scope', ['ci-test-fw'], tmpFile, db);
  console.log(`  [4/5] Exported SSP: ${exportResult.controls} controls → ${tmpFile}`);

  // Step 5: Validate
  const validationResult = validateOscalFile(tmpFile, 'ssp', { strict: true });

  console.log(`  [5/5] Validation: ${validationResult.passed ? 'PASSED' : 'FAILED'}`);
  console.log(`         ${validationResult.summary}`);

  for (const f of validationResult.all) {
    const icon = f.severity === 'ERROR' ? 'X' : f.severity === 'WARNING' ? '!' : '~';
    console.log(`         [${icon}] ${f.rule}: ${f.message}`);
  }

  // Cleanup
  fs.unlinkSync(tmpFile);
  db.close();

  if (!validationResult.passed) {
    console.log('\nFAILED: OSCAL export produced invalid output');
    process.exit(1);
  }

  console.log('\nPASSED: OSCAL export pipeline is valid');
}

main();
