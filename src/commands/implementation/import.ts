import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn } from '../../utils/logger.js';
import { parseCsv } from '../../importers/csv-generic.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting impl import` subcommand.
 */
export function registerImplImport(implCommand: Command): void {
  implCommand
    .command('import')
    .description('Bulk import implementation statements from a CSV file')
    .requiredOption('--format <format>', 'Import format (csv)')
    .requiredOption('--file <file>', 'Path to the CSV file')
    .requiredOption('--catalog <shortName>', 'Catalog short name')
    .requiredOption('--scope <name>', 'Scope name')
    .action(runImplImport);
}

interface ImplImportOptions {
  format: string;
  file: string;
  catalog: string;
  scope: string;
}

function runImplImport(options: ImplImportOptions): void {
  if (options.format !== 'csv') {
    error(`Unsupported format "${options.format}". Supported: csv`);
    process.exit(1);
  }

  const database = db.getDb();

  // Require organization
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    error('No organization found. Run `attesting org init --name <name>` first.');
    process.exit(1);
  }

  // Look up scope
  const scopeRow = database
    .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
    .get(options.scope) as { id: string } | undefined;

  if (!scopeRow) {
    error(`Scope not found: "${options.scope}". Use \`attesting scope create\` to create it.`);
    process.exit(1);
  }

  const filePath = path.resolve(options.file);
  info(`Importing implementations from: ${filePath}`);
  info(`Catalog: ${options.catalog}  |  Scope: ${options.scope}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsv(content);

  if (rows.length < 2) {
    error('CSV file is empty or has no data rows.');
    process.exit(1);
  }

  // Parse header row
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name);

  const idxControlId = col('control_id');
  const idxStatus = col('status');
  const idxResponse = col('sig_response');
  const idxStatement = col('statement');
  const idxRole = col('responsible_role');
  const idxResponsibility = col('responsibility_type');

  if (idxControlId === -1 || idxStatement === -1) {
    error('CSV must have at minimum "control_id" and "statement" columns.');
    process.exit(1);
  }

  // Prepare lookup and insert statements
  const lookupControl = database.prepare(
    `SELECT c.id
       FROM controls c
       JOIN catalogs cat ON c.catalog_id = cat.id
      WHERE cat.short_name = ? AND c.control_id = ?
      LIMIT 1`
  );

  const insertImpl = database.prepare(
    `INSERT INTO implementations
       (id, org_id, scope_id, primary_control_id, status, statement,
        responsible_role, sig_response, responsibility_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const dataRows = rows.slice(1);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const runImport = database.transaction(() => {
    dataRows.forEach((row, i) => {
      const rowNum = i + 2;

      const controlNativeId = row[idxControlId]?.trim();
      const statement = row[idxStatement]?.trim();

      if (!controlNativeId || !statement) {
        errors.push(`Row ${rowNum}: missing control_id or statement`);
        return;
      }

      const controlRow = lookupControl.get(options.catalog, controlNativeId) as
        | { id: string }
        | undefined;
      if (!controlRow) {
        warn(`Row ${rowNum}: control not found: ${options.catalog}:${controlNativeId} — skipping`);
        skipped++;
        return;
      }

      const status = (idxStatus !== -1 && row[idxStatus]?.trim()) || 'not-implemented';
      const sigResponse = (idxResponse !== -1 && row[idxResponse]?.trim()) || null;
      const responsibleRole = (idxRole !== -1 && row[idxRole]?.trim()) || null;
      const responsibilityType = (idxResponsibility !== -1 && row[idxResponsibility]?.trim()) || 'provider';
      const timestamp = now();

      try {
        insertImpl.run(
          generateUuid(),
          org.id,
          scopeRow.id,
          controlRow.id,
          status,
          statement,
          responsibleRole,
          sigResponse,
          responsibilityType,
          timestamp,
          timestamp
        );
        imported++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${rowNum} (${controlNativeId}): ${msg}`);
      }
    });
  });

  runImport();

  for (const e of errors) {
    error(e);
  }

  success(
    `Implementation import complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`
  );
}
