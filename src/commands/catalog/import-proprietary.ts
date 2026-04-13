import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, error } from '../../utils/logger.js';
import { detectFormat } from '../../services/import/detect-format.js';
import { previewImport, executeImport } from '../../services/import/pipeline.js';
import { scanFile } from '../../services/import/file-scanner.js';
import type { ImportFormat } from '../../services/import/detect-format.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

/**
 * Registers the `attesting catalog import-proprietary` subcommand.
 *
 * Usage:
 *   attesting catalog import-proprietary <file> \
 *     [--format <sig-xlsx|iso27001-xlsx|oscal-json|csv-generic>] \
 *     [--overwrite] \
 *     [--yes]
 */
export function registerImportProprietary(catalogCommand: Command): void {
  catalogCommand
    .command('import-proprietary <file>')
    .description('Import a proprietary/licensed catalog (SIG, ISO 27001, OSCAL, CSV)')
    .option('--format <format>', 'Override autodetected format')
    .option('--overwrite', 'Overwrite if catalog already exists')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON (implies --yes)')
    .action(runImportProprietary);
}

interface ImportProprietaryOptions {
  format?: string;
  overwrite?: boolean;
  yes?: boolean;
  json?: boolean;
}

async function runImportProprietary(
  file: string,
  options: ImportProprietaryOptions,
): Promise<void> {
  // Validate file exists
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const filename = path.basename(filePath);
  const database = db.getDb();

  // Security scan
  console.log('\n  Scanning file...');
  const scan = scanFile(filePath, filename);
  if (!scan.safe) {
    error(`File rejected: ${scan.rejected_reason}`);
    process.exit(1);
  }
  console.log(`  ✓ Passed ${scan.checks_passed.length} security checks (${(scan.file_size / 1024).toFixed(0)} KB)`);

  // Detect format
  const detection = detectFormat(filename);
  const format = (options.format as ImportFormat) ?? detection.format;

  if (format === 'unknown') {
    error(`Could not detect format for "${filename}".`);
    console.log('  Use --format with one of: sig-xlsx, iso27001-xlsx, oscal-json, csv-generic');
    process.exit(1);
  }

  console.log(`\n  File:     ${filename}`);
  console.log(`  Format:   ${format} (${detection.confidence} confidence — ${detection.reason})`);

  // Preview
  console.log('\n  Analyzing file...\n');
  const preview = previewImport(database, filePath, filename, format);

  if (preview.warnings.length > 0) {
    for (const w of preview.warnings) {
      console.log(`  ⚠ ${w}`);
    }
    console.log();
  }

  if (preview.control_count === 0) {
    error('No controls found in file. Check format and column headers.');
    process.exit(1);
  }

  // Display preview
  console.log(`  Catalog:  ${preview.catalog_name}`);
  console.log(`  Controls: ${preview.control_count}`);
  console.log(`  Mappings: ${preview.mapping_count} cross-framework mappings found`);

  if (preview.would_overwrite) {
    console.log(`  ⚠ Catalog "${preview.catalog_short_name}" already exists and will be overwritten.`);
    if (!options.overwrite) {
      error('Use --overwrite to replace the existing catalog.');
      process.exit(1);
    }
  }

  // Sample controls
  console.log('\n  Sample controls:');
  const sample = preview.controls.slice(0, 5);
  for (const ctrl of sample) {
    console.log(`    ${ctrl.control_id.padEnd(16)} ${ctrl.title.substring(0, 60)}`);
  }
  if (preview.control_count > 5) {
    console.log(`    ... and ${preview.control_count - 5} more`);
  }

  // Sample mappings
  if (preview.mappings.length > 0) {
    console.log('\n  Sample mappings:');
    const mapSample = preview.mappings.slice(0, 5);
    for (const m of mapSample) {
      console.log(`    ${m.imported_control_id.padEnd(16)} → ${m.maps_to_catalog}:${m.maps_to_control_id} (${m.relationship})`);
    }
    if (preview.mappings.length > 5) {
      console.log(`    ... and ${preview.mappings.length - 5} more`);
    }
  }

  // Confirm (--json implies --yes)
  if (!options.yes && !options.json) {
    const confirmed = await confirm('\n  Proceed with import? (y/N) ');
    if (!confirmed) {
      console.log('  Import cancelled.');
      return;
    }
  }

  // Execute
  const result = executeImport(database, filePath, filename, format, options.overwrite);

  if (result.controls_imported === 0 && result.warnings.length > 0) {
    for (const w of result.warnings) error(w);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({
      catalog_id: result.catalog_id,
      catalog_name: preview.catalog_name,
      controls_imported: result.controls_imported,
      mappings_resolved: result.mappings_resolved,
      warnings: result.warnings,
    }, null, 2));
    return;
  }

  success(`Imported ${result.controls_imported} controls into "${preview.catalog_name}"`);
  console.log(`  Catalog ID:     ${result.catalog_id}`);
  console.log(`  Auto-mappings:  ${result.mappings_resolved}`);

  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  }
  console.log();
}

function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
