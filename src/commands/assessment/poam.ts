/**
 * POA&M (Plan of Action and Milestones) command.
 *
 * For each 'not-satisfied' or 'partial' assessment result:
 *   - Creates a poam_items record if one does not already exist.
 *   - poam_id is sequential within the org: POAM-001, POAM-002, ...
 *   - Priority is derived from risk_level (critical→critical, high→high, else medium).
 *
 * If --output is provided, also exports a POA&M .xlsx workbook.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error, log } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the `attesting assessment poam` subcommand.
 *
 * Usage:
 *   attesting assessment poam --assessment <name-or-id> [--output <file.xlsx>]
 */
export function registerAssessmentPoam(assessmentCommand: Command): void {
  assessmentCommand
    .command('poam')
    .description('Generate POA&M items for unmet assessment results')
    .requiredOption('--assessment <name-or-id>', 'Assessment name or ID')
    .option('--output <file.xlsx>', 'Export POA&M workbook to this path')
    .option('--json', 'Output as JSON')
    .action(runAssessmentPoam);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssessmentRow {
  id: string;
  name: string;
  org_id: string;
}

interface AssessmentResultRow {
  id: string;
  control_id: string;     // UUID
  control_native_id: string;
  result: string;
  finding: string | null;
  risk_level: string | null;
}

interface PoamItemRow {
  id: string;
  poam_id: string;
  control_id: string;
  control_native_id: string;
  priority: string;
  finding: string;
  current_state: string | null;
  required_action: string;
  target_date: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Main action
// ---------------------------------------------------------------------------

async function runAssessmentPoam(options: {
  assessment: string;
  output?: string;
  json?: boolean;
}): Promise<void> {
  const database = db.getDb();

  // Find assessment
  const assessment = database
    .prepare(
      `SELECT id, name, org_id FROM assessments WHERE id = ? OR name = ? LIMIT 1`
    )
    .get(options.assessment, options.assessment) as AssessmentRow | undefined;

  if (!assessment) {
    error(`Assessment not found: "${options.assessment}"`);
    process.exit(1);
  }

  // Load not-satisfied and partial results
  const results = database
    .prepare(
      `SELECT
         ar.id,
         ar.control_id,
         c.control_id AS control_native_id,
         ar.result,
         ar.finding,
         ar.risk_level
       FROM assessment_results ar
       JOIN controls c ON ar.control_id = c.id
       WHERE ar.assessment_id = ?
         AND ar.result IN ('not-satisfied', 'partial')
       ORDER BY c.sort_order, c.control_id`
    )
    .all(assessment.id) as AssessmentResultRow[];

  if (results.length === 0) {
    log('No unmet results found — no POA&M items created.');
    return;
  }

  // Determine the next sequential POAM number for this org
  const maxPoamRow = database
    .prepare(
      `SELECT MAX(CAST(REPLACE(poam_id, 'POAM-', '') AS INTEGER)) AS maxNum
       FROM poam_items WHERE org_id = ?`
    )
    .get(assessment.org_id) as { maxNum: number | null };

  let nextPoamNum = (maxPoamRow.maxNum ?? 0) + 1;
  let created = 0;

  const insertPoam = database.prepare(
    `INSERT INTO poam_items
       (id, org_id, assessment_result_id, control_id, poam_id, priority,
        finding, required_action, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not-started', ?, ?)`
  );

  const timestamp = now();

  const createPoamItems = database.transaction(() => {
    for (const result of results) {
      // Skip if a POA&M item already exists for this assessment result
      const existing = database
        .prepare(
          `SELECT id FROM poam_items WHERE assessment_result_id = ? LIMIT 1`
        )
        .get(result.id);

      if (existing) continue;

      const priority = _derivePriority(result.risk_level);
      const poamId = `POAM-${String(nextPoamNum).padStart(3, '0')}`;
      const finding =
        result.finding ?? `Control not implemented: ${result.control_native_id}`;
      const requiredAction = `Implement control ${result.control_native_id}`;

      insertPoam.run(
        generateUuid(),
        assessment.org_id,
        result.id,
        result.control_id,
        poamId,
        priority,
        finding,
        requiredAction,
        timestamp,
        timestamp
      );

      nextPoamNum++;
      created++;
    }
  });

  createPoamItems();

  if (options.json) {
    // Load all poam_items for this assessment
    const poamItems = database
      .prepare(
        `SELECT p.*, c.control_id AS control_native_id
         FROM poam_items p
         JOIN assessment_results ar ON p.assessment_result_id = ar.id
         JOIN controls c ON p.control_id = c.id
         WHERE ar.assessment_id = ?
         ORDER BY p.poam_id`
      )
      .all(assessment.id);
    console.log(JSON.stringify(poamItems, null, 2));
    return;
  }

  success(
    `POA&M: ${created} new item(s) created for assessment "${assessment.name}".`
  );

  // Export workbook if requested
  if (options.output) {
    await _exportPoamWorkbook(assessment, results, options.output, database);
    success(`POA&M workbook exported → ${path.resolve(options.output)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a POA&M priority from the assessment result's risk level.
 */
function _derivePriority(
  riskLevel: string | null
): 'critical' | 'high' | 'medium' {
  switch (riskLevel) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    default:
      return 'medium';
  }
}

/**
 * Exports a POA&M .xlsx workbook.
 */
async function _exportPoamWorkbook(
  assessment: AssessmentRow,
  results: AssessmentResultRow[],
  outputPath: string,
  database: Database.Database
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Attesting';
  wb.created = new Date();

  const sheet = wb.addWorksheet('POA&M');

  // Column widths
  const widths = [12, 15, 12, 50, 35, 45, 15, 15];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // Header
  const headers = [
    'POA&M ID', 'Control ID', 'Priority', 'Finding',
    'Current State', 'Required Action', 'Target Date', 'Status',
  ];

  const headerFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9E1F2' },
  };

  const headerRow = sheet.getRow(1);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = headerFill;
  });
  headerRow.commit();

  // Load poam_items for this assessment's results
  const poamItems = database
    .prepare(
      `SELECT
         p.poam_id, c.control_id AS control_native_id, p.priority,
         p.finding, p.current_state, p.required_action, p.target_date, p.status
       FROM poam_items p
       JOIN assessment_results ar ON p.assessment_result_id = ar.id
       JOIN controls c ON p.control_id = c.id
       WHERE ar.assessment_id = ?
       ORDER BY p.poam_id`
    )
    .all(assessment.id) as PoamItemRow[];

  poamItems.forEach((item, idx) => {
    const row = sheet.getRow(idx + 2);
    row.getCell(1).value = item.poam_id;
    row.getCell(2).value = item.control_native_id;
    row.getCell(3).value = item.priority;
    row.getCell(4).value = item.finding;
    row.getCell(5).value = item.current_state ?? '';
    row.getCell(6).value = item.required_action;
    row.getCell(7).value = item.target_date ?? '';
    row.getCell(8).value = item.status;
    row.commit();
  });

  await wb.xlsx.writeFile(path.resolve(outputPath));
}
