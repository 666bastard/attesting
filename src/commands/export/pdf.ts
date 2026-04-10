import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { exportPdfReport } from '../../exporters/pdf-report.js';
import { success, error } from '../../utils/logger.js';

/**
 * Registers the `attesting export pdf` subcommand.
 *
 * Usage:
 *   attesting export pdf [--scope <scope_name>]
 *                        [--catalogs <comma-separated>]
 *                        --output <file.pdf>
 */
export function registerExportPdf(exportCommand: Command): void {
  exportCommand
    .command('pdf')
    .description('Export a PDF compliance summary report')
    .option('--scope <scope_name>', 'Limit to a specific scope')
    .option('--catalogs <catalogs>', 'Comma-separated catalog short names to include')
    .requiredOption('--output <file.pdf>', 'Output path for the generated PDF')
    .action(runExportPdf);
}

interface ExportPdfOptions {
  scope?: string;
  catalogs?: string;
  output: string;
}

function runExportPdf(options: ExportPdfOptions): void {
  const database = db.getDb();

  const catalogShortNames: string[] = options.catalogs
    ? options.catalogs.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  try {
    const result = exportPdfReport(
      options.scope,
      catalogShortNames,
      options.output,
      database
    );
    success(`PDF report exported: ${result.pages} page(s) → ${options.output}`);
  } catch (err) {
    error(`Export failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
