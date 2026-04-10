import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { exportSigQuestionnaire } from '../../exporters/sig-questionnaire.js';
import { success, error } from '../../utils/logger.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting export sig` subcommand.
 *
 * Usage:
 *   attesting export sig --catalog <short-name> [--scope <scope>]
 *                        [--format response-sig|questionnaire]
 *                        --output <file.xlsx>
 */
export function registerExportSig(exportCommand: Command): void {
  exportCommand
    .command('sig')
    .description('Export a SIG-compatible .xlsx questionnaire')
    .requiredOption('--catalog <short-name>', 'Short name of the SIG catalog to export')
    .option('--scope <scope_name>', 'Limit to a specific scope')
    .option('--format <mode>', 'Export mode: response-sig or questionnaire', 'response-sig')
    .requiredOption('--output <file.xlsx>', 'Output path for the generated workbook')
    .action(runExportSig);
}

interface ExportSigOptions {
  catalog: string;
  scope?: string;
  format: string;
  output: string;
}

async function runExportSig(options: ExportSigOptions): Promise<void> {
  const database = db.getDb();

  // Validate export mode
  const mode = options.format;
  if (mode !== 'response-sig' && mode !== 'questionnaire') {
    error(`Invalid format "${mode}". Must be "response-sig" or "questionnaire".`);
    process.exit(1);
  }

  // Fetch org name for Business Information sheet
  const org = database
    .prepare('SELECT name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'name'> | undefined;

  try {
    const result = await exportSigQuestionnaire(
      {
        catalogShortName: options.catalog,
        scopeName: options.scope,
        mode: mode as 'response-sig' | 'questionnaire',
        outputPath: options.output,
        orgName: org?.name,
      },
      database
    );

    success(
      `SIG questionnaire exported: ${result.exported} question(s) → ${result.outputPath}`
    );
  } catch (err) {
    error(`Export failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
