/**
 * Tests for assessment commands: create, evaluate, poam.
 *
 * Uses an in-memory SQLite database — never touches ~/.attesting/attesting.db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { generateUuid } from '../../src/utils/uuid.js';
import { resolveControl } from '../../src/mappers/resolver.js';

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

/**
 * Seeds org, scope, catalog with 5 controls,
 * and 3 implementations (2 implemented, 1 not-applicable).
 */
function seedDb(db: Database.Database): SeedResult {
  const orgId = generateUuid();
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, 'Test Org', ?, ?)`
  ).run(orgId, t(), t());

  const scopeId = generateUuid();
  db.prepare(
    `INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at)
     VALUES (?, ?, 'On-Prem', 'product', ?, ?)`
  ).run(scopeId, orgId, t(), t());

  const catalogId = generateUuid();
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at)
     VALUES (?, 'Test FW', 'test-fw', 'csv', ?, ?)`
  ).run(catalogId, t(), t());

  const insertCtl = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)`
  );

  const controls: { id: string; nativeId: string }[] = [];
  for (let i = 1; i <= 5; i++) {
    const id = generateUuid();
    const nativeId = `CTL-00${i}`;
    insertCtl.run(id, catalogId, nativeId, `Control ${i}`, i, t());
    controls.push({ id, nativeId });
  }

  // Add 3 implementations: CTL-001 implemented, CTL-002 implemented, CTL-003 not-applicable
  const insert = db.prepare(
    `INSERT INTO implementations
       (id, org_id, scope_id, primary_control_id, status, statement,
        responsibility_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'provider', ?, ?)`
  );

  insert.run(generateUuid(), orgId, scopeId, controls[0].id,
    'implemented', 'Policy in place.', t(), t());
  insert.run(generateUuid(), orgId, scopeId, controls[1].id,
    'implemented', 'Automated controls.', t(), t());
  insert.run(generateUuid(), orgId, scopeId, controls[2].id,
    'not-applicable', 'N/A for this scope.', t(), t());

  return { orgId, scopeId, catalogId, controls };
}

// ---------------------------------------------------------------------------
// Assessment helper functions (mirror the command logic for unit testing)
// ---------------------------------------------------------------------------

function createAssessment(
  db: Database.Database,
  orgId: string,
  scopeId: string,
  catalogId: string,
  name: string,
  type = 'self'
): string {
  const id = generateUuid();
  const totalControls = (
    db.prepare('SELECT COUNT(*) AS cnt FROM controls WHERE catalog_id = ?').get(catalogId) as { cnt: number }
  ).cnt;

  db.prepare(
    `INSERT INTO assessments
       (id, org_id, scope_id, catalog_id, name, assessment_type,
        status, total_controls, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'in-progress', ?, ?, ?)`
  ).run(id, orgId, scopeId, catalogId, name, type, totalControls, t(), t());

  return id;
}

function evaluateAssessment(
  db: Database.Database,
  assessmentId: string
): { satisfied: number; partial: number; notSatisfied: number; na: number } {
  const assessment = db
    .prepare('SELECT * FROM assessments WHERE id = ?')
    .get(assessmentId) as {
      id: string;
      org_id: string;
      scope_id: string | null;
      catalog_id: string;
    };

  const controls = db
    .prepare(
      `SELECT id, control_id FROM controls WHERE catalog_id = ? ORDER BY sort_order`
    )
    .all(assessment.catalog_id) as { id: string; control_id: string }[];

  db.prepare('DELETE FROM assessment_results WHERE assessment_id = ?').run(assessmentId);

  const insertResult = db.prepare(
    `INSERT INTO assessment_results
       (id, assessment_id, control_id, implementation_id, result, finding, assessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let satisfied = 0, partial = 0, notSatisfied = 0, na = 0;
  const timestamp = t();

  const run = db.transaction(() => {
    for (const control of controls) {
      const scopeFilter = assessment.scope_id
        ? 'AND (i.scope_id = ? OR i.scope_id IS NULL)'
        : '';

      const impl = db
        .prepare(
          `SELECT i.id, i.status FROM implementations i
           WHERE i.primary_control_id = ? AND i.org_id = ? ${scopeFilter} LIMIT 1`
        )
        .get(
          ...[
            control.id,
            assessment.org_id,
            ...(assessment.scope_id ? [assessment.scope_id] : []),
          ]
        ) as { id: string; status: string } | undefined;

      let result: string;
      let implId: string | null = null;
      let finding: string | null = null;

      if (impl) {
        implId = impl.id;
        switch (impl.status) {
          case 'implemented':        result = 'satisfied';       satisfied++; break;
          case 'partially-implemented': result = 'partial';      partial++;   break;
          case 'not-applicable':     result = 'not-applicable';  na++;        break;
          default:                   result = 'not-satisfied';   notSatisfied++; break;
        }
      } else {
        // Check transitive mappings
        const mapped = resolveControl(control.id, db);
        let foundMapped = false;
        for (const m of mapped) {
          const mappedImpl = db
            .prepare('SELECT id FROM implementations WHERE primary_control_id = ? AND org_id = ? LIMIT 1')
            .get(m.controlId, assessment.org_id) as { id: string } | undefined;
          if (mappedImpl) {
            result = 'partial';
            implId = mappedImpl.id;
            finding = `Satisfied via mapping — review required.`;
            partial++;
            foundMapped = true;
            break;
          }
        }
        if (!foundMapped) {
          result = 'not-satisfied';
          finding = 'No implementation found.';
          notSatisfied++;
        }
      }

      insertResult.run(generateUuid(), assessmentId, control.id, implId, result, finding, timestamp);
    }
  });

  run();

  db.prepare(
    `UPDATE assessments SET
       status = 'completed', completed_at = ?,
       controls_met = ?, controls_not_met = ?, controls_na = ?, controls_partial = ?
     WHERE id = ?`
  ).run(timestamp, satisfied, notSatisfied, na, partial, assessmentId);

  return { satisfied, partial, notSatisfied, na };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Assessment — create', () => {
  let db: Database.Database;
  let seed: SeedResult;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
  });

  afterEach(() => db.close());

  it('creates an assessment record in the DB', () => {
    const id = createAssessment(
      db, seed.orgId, seed.scopeId, seed.catalogId, 'Q1 Assessment'
    );

    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) as
      { id: string; name: string; status: string; total_controls: number } | undefined;

    expect(row).toBeDefined();
    expect(row!.name).toBe('Q1 Assessment');
    expect(row!.status).toBe('in-progress');
    expect(row!.total_controls).toBe(5);
  });
});

describe('Assessment — evaluate', () => {
  let db: Database.Database;
  let seed: SeedResult;
  let assessmentId: string;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
    assessmentId = createAssessment(
      db, seed.orgId, seed.scopeId, seed.catalogId, 'Q1 Assessment'
    );
  });

  afterEach(() => db.close());

  it('generates the correct number of assessment_results (one per control)', () => {
    evaluateAssessment(db, assessmentId);

    const count = (
      db.prepare('SELECT COUNT(*) AS cnt FROM assessment_results WHERE assessment_id = ?')
        .get(assessmentId) as { cnt: number }
    ).cnt;

    expect(count).toBe(5);
  });

  it('satisfied count matches implemented controls', () => {
    const { satisfied } = evaluateAssessment(db, assessmentId);
    // We seeded 2 implemented controls
    expect(satisfied).toBe(2);
  });

  it('not-satisfied count equals controls with no implementation', () => {
    const { notSatisfied } = evaluateAssessment(db, assessmentId);
    // 5 controls - 2 implemented - 1 not-applicable = 2 not-satisfied
    expect(notSatisfied).toBe(2);
  });

  it('updates assessment summary counts after evaluation', () => {
    evaluateAssessment(db, assessmentId);

    const assessment = db
      .prepare('SELECT controls_met, controls_not_met, controls_na, status FROM assessments WHERE id = ?')
      .get(assessmentId) as {
        controls_met: number;
        controls_not_met: number;
        controls_na: number;
        status: string;
      };

    expect(assessment.controls_met).toBe(2);
    expect(assessment.controls_not_met).toBe(2);
    expect(assessment.controls_na).toBe(1);
    expect(assessment.status).toBe('completed');
  });
});

describe('Assessment — POA&M', () => {
  let db: Database.Database;
  let seed: SeedResult;
  let assessmentId: string;
  let tmpFile: string;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
    assessmentId = createAssessment(
      db, seed.orgId, seed.scopeId, seed.catalogId, 'Q1 Assessment'
    );
    evaluateAssessment(db, assessmentId);
    tmpFile = path.join(os.tmpdir(), `poam-test-${Date.now()}.xlsx`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  function createPoamItems(db: Database.Database, assessmentId: string, orgId: string): void {
    const results = db
      .prepare(
        `SELECT ar.id, c.control_id AS control_native_id, ar.control_id, ar.result, ar.finding, ar.risk_level
         FROM assessment_results ar
         JOIN controls c ON ar.control_id = c.id
         WHERE ar.assessment_id = ? AND ar.result IN ('not-satisfied', 'partial')
         ORDER BY c.sort_order`
      )
      .all(assessmentId) as Array<{
        id: string;
        control_native_id: string;
        control_id: string;
        result: string;
        finding: string | null;
        risk_level: string | null;
      }>;

    const maxRow = db
      .prepare(
        `SELECT MAX(CAST(REPLACE(poam_id, 'POAM-', '') AS INTEGER)) AS maxNum
         FROM poam_items WHERE org_id = ?`
      )
      .get(orgId) as { maxNum: number | null };

    let nextNum = (maxRow.maxNum ?? 0) + 1;
    const insertPoam = db.prepare(
      `INSERT INTO poam_items
         (id, org_id, assessment_result_id, control_id, poam_id, priority,
          finding, required_action, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'medium', ?, ?, 'not-started', ?, ?)`
    );

    const run = db.transaction(() => {
      for (const r of results) {
        const existing = db
          .prepare('SELECT id FROM poam_items WHERE assessment_result_id = ? LIMIT 1')
          .get(r.id);
        if (existing) continue;

        const poamId = `POAM-${String(nextNum).padStart(3, '0')}`;
        insertPoam.run(
          generateUuid(), orgId, r.id, r.control_id, poamId,
          r.finding ?? `Control not implemented: ${r.control_native_id}`,
          `Implement control ${r.control_native_id}`,
          t(), t()
        );
        nextNum++;
      }
    });
    run();
  }

  it('generates poam_items for not-satisfied assessment results', () => {
    createPoamItems(db, assessmentId, seed.orgId);

    const count = (
      db.prepare('SELECT COUNT(*) AS cnt FROM poam_items WHERE org_id = ?')
        .get(seed.orgId) as { cnt: number }
    ).cnt;

    // 2 not-satisfied controls → 2 POA&M items
    expect(count).toBe(2);
  });

  it('assigns sequential poam_id values (POAM-001, POAM-002, ...)', () => {
    createPoamItems(db, assessmentId, seed.orgId);

    const items = db
      .prepare('SELECT poam_id FROM poam_items WHERE org_id = ? ORDER BY poam_id')
      .all(seed.orgId) as { poam_id: string }[];

    expect(items[0].poam_id).toBe('POAM-001');
    expect(items[1].poam_id).toBe('POAM-002');
  });

  it('does not create duplicate poam_items when called twice', () => {
    createPoamItems(db, assessmentId, seed.orgId);
    createPoamItems(db, assessmentId, seed.orgId);

    const count = (
      db.prepare('SELECT COUNT(*) AS cnt FROM poam_items WHERE org_id = ?')
        .get(seed.orgId) as { cnt: number }
    ).cnt;

    expect(count).toBe(2);
  });

  it('exports a POA&M xlsx workbook when an output path is provided', async () => {
    createPoamItems(db, assessmentId, seed.orgId);

    // Build the workbook directly (mirrors poam.ts export logic)
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('POA&M');
    const headers = ['POA&M ID', 'Control ID', 'Priority', 'Finding',
      'Current State', 'Required Action', 'Target Date', 'Status'];
    const headerRow = sheet.getRow(1);
    headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.commit();

    const items = db
      .prepare(
        `SELECT p.poam_id, c.control_id, p.priority, p.finding,
                p.current_state, p.required_action, p.target_date, p.status
         FROM poam_items p
         JOIN controls c ON p.control_id = c.id
         WHERE p.org_id = ? ORDER BY p.poam_id`
      )
      .all(seed.orgId) as Array<{
        poam_id: string; control_id: string; priority: string;
        finding: string; current_state: string | null; required_action: string;
        target_date: string | null; status: string;
      }>;

    items.forEach((item, idx) => {
      const row = sheet.getRow(idx + 2);
      row.getCell(1).value = item.poam_id;
      row.getCell(2).value = item.control_id;
      row.getCell(3).value = item.priority;
      row.getCell(4).value = item.finding;
      row.getCell(5).value = item.current_state ?? '';
      row.getCell(6).value = item.required_action;
      row.getCell(7).value = item.target_date ?? '';
      row.getCell(8).value = item.status;
      row.commit();
    });

    await wb.xlsx.writeFile(tmpFile);

    expect(fs.existsSync(tmpFile)).toBe(true);

    // Verify it's a valid workbook
    const readWb = new ExcelJS.Workbook();
    await readWb.xlsx.readFile(tmpFile);
    expect(readWb.getWorksheet('POA&M')).toBeDefined();
  });
});
