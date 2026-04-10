import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { exportSoaWorkbook } from '../../exporters/soa-workbook.js';
import { success, error } from '../../utils/logger.js';

/**
 * Registers the `attesting export soa` subcommand.
 *
 * Usage:
 *   attesting export soa [--scope <scope_name>] --output <file.xlsx>
 */
export function registerExportSoa(exportCommand: Command): void {
  exportCommand
    .command('soa')
    .description('Export an ISO 27001 Statement of Applicability .xlsx workbook')
    .option('--scope <scope_name>', 'Limit to a specific scope')
    .requiredOption('--output <file.xlsx>', 'Output path for the generated workbook')
    .action(runExportSoa);
}

interface ExportSoaOptions {
  scope?: string;
  output: string;
}

async function runExportSoa(options: ExportSoaOptions): Promise<void> {
  const database = db.getDb();

  try {
    const result = await exportSoaWorkbook(options.scope, options.output, database);
    success(`SOA workbook exported: ${result.controls} control(s) → ${options.output}`);
  } catch (err) {
    error(`Export failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
