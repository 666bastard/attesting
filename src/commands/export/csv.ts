import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { exportCsvFlat } from '../../exporters/csv-flat.js';
import { success, error } from '../../utils/logger.js';

/**
 * Registers the `attesting export csv` subcommand.
 *
 * Usage:
 *   attesting export csv [--scope <scope_name>] [--include-mappings]
 *                        --output <file.csv>
 */
export function registerExportCsv(exportCommand: Command): void {
  exportCommand
    .command('csv')
    .description('Export a flat CSV of all implementations')
    .option('--scope <scope_name>', 'Limit to a specific scope')
    .option('--include-mappings', 'Include pipe-separated mapped controls column')
    .requiredOption('--output <file.csv>', 'Output path for the generated CSV')
    .action(runExportCsv);
}

interface ExportCsvOptions {
  scope?: string;
  includeMappings?: boolean;
  output: string;
}

function runExportCsv(options: ExportCsvOptions): void {
  const database = db.getDb();

  try {
    const result = exportCsvFlat(
      options.scope,
      options.includeMappings ?? false,
      options.output,
      database
    );
    success(`CSV exported: ${result.rows} row(s) → ${options.output}`);
  } catch (err) {
    error(`Export failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
