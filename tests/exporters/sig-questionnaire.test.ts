/**
 * Tests for the SIG Questionnaire exporter.
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
import { exportSigQuestionnaire } from '../../src/exporters/sig-questionnaire.js';

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
 * Seeds an in-memory DB with an org, scope, SIG-style catalog and 3 controls.
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

  // SIG-style catalog — short_name must start with 'sig-' so the schema view
  // picks it up via the LIKE 'sig-%' filter.
  const catalogId = generateUuid();
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at)
     VALUES (?, 'SIG Lite 2026', 'sig-lite', 'csv', ?, ?)`
  ).run(catalogId, t(), t());

  const insertCtl = db.prepare(
    `INSERT INTO controls
       (id, catalog_id, control_id, title, description,
        sig_risk_domain, sig_control_family, sig_control_attribute, sig_scope_level,
        metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`
  );

  const controlDefs = [
    {
      nativeId: 'A.1',
      title: 'Risk Mgmt Policy',
      desc: 'Do you have a risk management policy?',
      domain: 'A. Enterprise Risk Management',
      family: 'Risk Management Principles',
      attr: 'Policies',
      level: 'Lite',
    },
    {
      nativeId: 'A.1.1',
      title: 'Policy Review',
      desc: 'Is the policy reviewed annually?',
      domain: 'A. Enterprise Risk Management',
      family: 'Risk Management Principles',
      attr: 'Policies',
      level: 'Lite',
    },
    {
      nativeId: 'B.1',
      title: 'Access Control Policy',
      desc: 'Do you have an access control policy?',
      domain: 'B. Security Policy',
      family: 'Access Control',
      attr: 'Policies',
      level: 'Lite',
    },
  ];

  const controls: { id: string; nativeId: string }[] = [];
  controlDefs.forEach((def, i) => {
    const id = generateUuid();
    insertCtl.run(
      id,
      catalogId,
      def.nativeId,
      def.title,
      def.desc,
      def.domain,
      def.family,
      def.attr,
      def.level,
      i + 1,
      t()
    );
    controls.push({ id, nativeId: def.nativeId });
  });

  return { orgId, scopeId, catalogId, controls };
}

function addImplementations(
  db: Database.Database,
  orgId: string,
  scopeId: string,
  controls: { id: string; nativeId: string }[]
): void {
  const insert = db.prepare(
    `INSERT INTO implementations
       (id, org_id, scope_id, primary_control_id, status, statement,
        sig_response, responsibility_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'provider', ?, ?)`
  );

  insert.run(
    generateUuid(), orgId, scopeId, controls[0].id,
    'implemented', 'We have a formal risk management policy.', 'Yes', t(), t()
  );
  insert.run(
    generateUuid(), orgId, scopeId, controls[1].id,
    'partially-implemented', 'Policy is reviewed every 2 years.', 'No', t(), t()
  );
  insert.run(
    generateUuid(), orgId, scopeId, controls[2].id,
    'not-applicable', 'N/A for this deployment.', 'N/A', t(), t()
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SIG Questionnaire Exporter', () => {
  let db: Database.Database;
  let seed: SeedResult;
  let tmpFile: string;

  beforeEach(() => {
    db = createTestDb();
    seed = seedDb(db);
    tmpFile = path.join(os.tmpdir(), `sig-test-${Date.now()}.xlsx`);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('creates a file at the specified output path', async () => {
    const result = await exportSigQuestionnaire(
      {
        catalogShortName: 'sig-lite',
        mode: 'response-sig',
        outputPath: tmpFile,
      },
      db
    );

    expect(fs.existsSync(result.outputPath)).toBe(true);
  });

  it('produces a valid Excel workbook with correct sheet names', async () => {
    await exportSigQuestionnaire(
      {
        catalogShortName: 'sig-lite',
        mode: 'response-sig',
        outputPath: tmpFile,
      },
      db
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tmpFile);

    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toContain('Copyright');
    expect(names).toContain('Instructions');
    expect(names).toContain('Dashboard');
    expect(names).toContain('Business Information');
    expect(names).toContain('SIG Questions');
    expect(names).toContain('Full');
  });

  it('SIG Questions sheet has the correct headers in row 1', async () => {
    await exportSigQuestionnaire(
      {
        catalogShortName: 'sig-lite',
        mode: 'response-sig',
        outputPath: tmpFile,
      },
      db
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tmpFile);
    const sheet = wb.getWorksheet('SIG Questions');
    expect(sheet).toBeDefined();

    const headerRow = sheet!.getRow(1);
    expect(headerRow.getCell(1).value).toBe('Risk Domain');
    expect(headerRow.getCell(2).value).toBe('Question Number');
    expect(headerRow.getCell(3).value).toBe('Question / Request');
    expect(headerRow.getCell(4).value).toBe('Response');
    expect(headerRow.getCell(5).value).toBe('Additional Information');
  });

  it('response-sig mode pre-fills response and statement columns', async () => {
    addImplementations(db, seed.orgId, seed.scopeId, seed.controls);

    await exportSigQuestionnaire(
      {
        catalogShortName: 'sig-lite',
        scopeName: 'On-Prem',
        mode: 'response-sig',
        outputPath: tmpFile,
      },
      db
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tmpFile);
    const sheet = wb.getWorksheet('SIG Questions')!;

    // Row 2 = first data row (A.1 → implemented, sig_response = Yes)
    const responseCell = sheet.getRow(2).getCell(4).value;
    const infoCell = sheet.getRow(2).getCell(5).value;

    expect(responseCell).toBe('Yes');
    expect(infoCell).toBe('We have a formal risk management policy.');
  });

  it('questionnaire mode leaves response and info columns empty', async () => {
    addImplementations(db, seed.orgId, seed.scopeId, seed.controls);

    await exportSigQuestionnaire(
      {
        catalogShortName: 'sig-lite',
        scopeName: 'On-Prem',
        mode: 'questionnaire',
        outputPath: tmpFile,
      },
      db
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tmpFile);
    const sheet = wb.getWorksheet('SIG Questions')!;

    const responseCell = sheet.getRow(2).getCell(4).value;
    const infoCell = sheet.getRow(2).getCell(5).value;

    // Should be blank
    expect(responseCell).toBeFalsy();
    expect(infoCell).toBeFalsy();
  });

  it('data row count matches the number of controls in the catalog', async () => {
    await exportSigQuestionnaire(
      {
        catalogShortName: 'sig-lite',
        mode: 'response-sig',
        outputPath: tmpFile,
      },
      db
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(tmpFile);
    const sheet = wb.getWorksheet('SIG Questions')!;

    // Count non-empty rows beyond the header
    let dataRows = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(2).value) dataRows++;
    });

    // We seeded 3 controls
    expect(dataRows).toBe(3);
  });
});
