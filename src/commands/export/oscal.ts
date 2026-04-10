import { Command } from 'commander';
import { db } from '../../db/connection.js';
import {
  exportOscalComponentDefinition,
  exportOscalSsp,
} from '../../exporters/oscal-json.js';
import {
  validateOscalFile,
  type OscalDocType,
} from '../../validators/oscal.js';
import { success, error, info, warn, log } from '../../utils/logger.js';

/**
 * Registers the `attesting export oscal` subcommand.
 *
 * Usage:
 *   attesting export oscal --type component-definition|ssp
 *                          [--scope <scope_name>]
 *                          [--catalogs <comma-separated>]
 *                          --output <file.json>
 *
 *   attesting export oscal --validate --input <file.json> --type ssp [--strict]
 */
export function registerExportOscal(exportCommand: Command): void {
  exportCommand
    .command('oscal')
    .description('Export an OSCAL 1.1.2 JSON document or validate an existing one')
    .option(
      '--type <type>',
      'Document type: component-definition or ssp'
    )
    .option('--scope <scope_name>', 'Scope to export')
    .option(
      '--catalogs <catalogs>',
      'Comma-separated catalog short names to include (default: all)'
    )
    .option('--output <file.json>', 'Output path for the generated JSON file')
    .option('--validate', 'Validate an existing OSCAL document instead of exporting')
    .option('--input <file.json>', 'Path to OSCAL document to validate')
    .option('--strict', 'Treat warnings as errors during validation')
    .action(runExportOscal);
}

interface ExportOscalOptions {
  type?: string;
  scope?: string;
  catalogs?: string;
  output?: string;
  validate?: boolean;
  input?: string;
  strict?: boolean;
}

function runExportOscal(options: ExportOscalOptions): void {
  // --- Validate mode ---
  if (options.validate) {
    runValidate(options);
    return;
  }

  // --- Export mode ---
  const database = db.getDb();

  if (!options.type) {
    error('--type is required for export. Use "component-definition" or "ssp".');
    process.exit(1);
  }

  if (options.type !== 'component-definition' && options.type !== 'ssp') {
    error(
      `Invalid type "${options.type}". Must be "component-definition" or "ssp".`
    );
    process.exit(1);
  }

  if (!options.scope) {
    error('--scope is required for OSCAL export.');
    process.exit(1);
  }

  if (!options.output) {
    error('--output is required for OSCAL export.');
    process.exit(1);
  }

  const catalogShortNames: string[] = options.catalogs
    ? options.catalogs.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  try {
    if (options.type === 'component-definition') {
      const result = exportOscalComponentDefinition(
        options.scope,
        catalogShortNames,
        options.output,
        database
      );
      success(
        `OSCAL Component Definition exported: ${result.implementations} implementation(s) → ${options.output}`
      );
    } else {
      const result = exportOscalSsp(
        options.scope,
        catalogShortNames,
        options.output,
        database
      );
      success(
        `OSCAL SSP exported: ${result.controls} control(s) → ${options.output}`
      );
    }
  } catch (err) {
    error(`Export failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

function runValidate(options: ExportOscalOptions): void {
  if (!options.input) {
    error('--input is required for validation. Provide the path to the OSCAL document.');
    process.exit(1);
  }
  if (!options.type) {
    error('--type is required for validation. Use "ssp", "poam", "component-definition", etc.');
    process.exit(1);
  }

  const validTypes = ['ssp', 'sap', 'sar', 'poam', 'catalog', 'profile', 'component-definition'];
  if (!validTypes.includes(options.type)) {
    error(`Invalid type "${options.type}". Supported: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  info(`Validating: ${options.input} (type: ${options.type})`);

  const result = validateOscalFile(
    options.input,
    options.type as OscalDocType,
    { strict: options.strict }
  );

  // Print results
  const status = result.passed ? 'PASSED' : 'FAILED';
  log('');
  log(`  OSCAL Validation: ${status}`);
  log(`  Document: ${options.input}`);
  log(`  Type: ${options.type.toUpperCase()}`);
  log(`  ${result.summary}`);
  log('');

  for (const finding of result.all) {
    const icon =
      finding.severity === 'ERROR' ? '\x1b[31m✖\x1b[0m' :
      finding.severity === 'WARNING' ? '\x1b[33m⚠\x1b[0m' :
      '\x1b[36m~\x1b[0m';
    const path = finding.path ? ` (${finding.path})` : '';
    log(`  ${icon} ${finding.rule}: ${finding.message}${path}`);
  }

  log('');

  // Exit code
  if (options.strict) {
    if (!result.passed || result.warnings.length > 0) process.exit(1);
  } else {
    if (!result.passed) process.exit(1);
  }
}
