import { Command } from 'commander';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn } from '../../utils/logger.js';
import {
  importCsvCatalog,
  type ColumnMapping,
} from '../../importers/csv-generic.js';
import {
  importSigCatalog,
} from '../../importers/sig-content-library.js';
import {
  importOscalCatalog,
} from '../../importers/oscal-catalog.js';
import type { Catalog } from '../../models/catalog.js';

/**
 * Registers the `attesting catalog import` subcommand.
 */
export function registerCatalogImport(catalogCommand: Command): void {
  catalogCommand
    .command('import')
    .description('Import a control catalog from a file')
    .requiredOption('--format <format>', 'Import format: csv | sig | oscal')
    .requiredOption('--file <file>', 'Path to the source file')
    .requiredOption('--name <name>', 'Catalog display name')
    .requiredOption('--short-name <shortName>', 'Unique short identifier (e.g. iso-27001-2022)')
    .option('--columns <mapping>', 'Column mapping for CSV: "control_id=A,title=B,description=C"')
    .option('--publisher <publisher>', 'Publisher name (e.g. NIST, ISO)')
    .option('--version <version>', 'Catalog version string')
    .option('--scope-level <level>', 'SIG scope level filter: Lite | Core | Detail')
    .action(runCatalogImport);
}

interface CatalogImportOptions {
  format: string;
  file: string;
  name: string;
  shortName: string;
  columns?: string;
  publisher?: string;
  version?: string;
  scopeLevel?: string;
}

async function runCatalogImport(options: CatalogImportOptions): Promise<void> {
  const supportedFormats = ['csv', 'sig', 'oscal'];
  if (!supportedFormats.includes(options.format)) {
    error(`Unsupported format "${options.format}". Supported: ${supportedFormats.join(', ')}`);
    process.exit(1);
  }

  const database = db.getDb();
  const filePath = path.resolve(options.file);

  // Check for duplicate short_name
  const existing = database
    .prepare('SELECT id, name FROM catalogs WHERE short_name = ?')
    .get(options.shortName) as Pick<Catalog, 'id' | 'name'> | undefined;

  if (existing) {
    error(
      `A catalog with short-name "${options.shortName}" already exists: "${existing.name}". ` +
        'Use a unique --short-name.'
    );
    process.exit(1);
  }

  // Create the catalog record
  const catalogId = generateUuid();
  const timestamp = now();

  const sourceFormat = options.format === 'sig' ? 'sig-xlsm' : options.format;

  database
    .prepare(
      `INSERT INTO catalogs (id, name, short_name, version, source_format, publisher, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      catalogId,
      options.name,
      options.shortName,
      options.version ?? null,
      sourceFormat,
      options.publisher ?? null,
      timestamp,
      timestamp
    );

  info(`Importing catalog: ${options.name} (${options.shortName})`);
  info(`Source file: ${filePath}`);

  if (options.format === 'csv') {
    runCsvImport(options, catalogId, filePath, database);
  } else if (options.format === 'sig') {
    await runSigImport(options, catalogId, filePath, database);
  } else if (options.format === 'oscal') {
    runOscalImport(options, catalogId, filePath, database);
  }
}

function parseColumnMapping(raw: string): ColumnMapping {
  const mapping: Record<string, string> = {};
  const pairs = raw.split(',');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key && value) {
      mapping[key] = value;
    }
  }
  return mapping as ColumnMapping;
}

function runCsvImport(
  options: CatalogImportOptions,
  catalogId: string,
  filePath: string,
  database: import('better-sqlite3').Database
): void {
  if (!options.columns) {
    error('--columns is required for CSV format. Example: "control_id=A,title=B,description=C"');
    process.exit(1);
  }

  const columnMapping = parseColumnMapping(options.columns);
  if (!columnMapping.control_id) {
    error('Column mapping must include at least "control_id". Example: "control_id=A,title=B"');
    process.exit(1);
  }

  const result = importCsvCatalog(filePath, catalogId, columnMapping);

  database
    .prepare('UPDATE catalogs SET total_controls = ?, updated_at = ? WHERE id = ?')
    .run(result.imported, now(), catalogId);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
  }

  success(`Import complete: ${result.imported} controls imported into "${options.name}"`);

  if (result.errors.length > 0) {
    warn(`${result.errors.length} row(s) had errors and were skipped.`);
  }
}

async function runSigImport(
  options: CatalogImportOptions,
  catalogId: string,
  filePath: string,
  database: import('better-sqlite3').Database
): Promise<void> {
  if (options.scopeLevel) {
    info(`Filtering by scope level: ${options.scopeLevel}`);
  }

  const result = await importSigCatalog(
    filePath,
    catalogId,
    database,
    options.scopeLevel
  );

  database
    .prepare('UPDATE catalogs SET total_controls = ?, updated_at = ? WHERE id = ?')
    .run(result.imported, now(), catalogId);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
  }

  success(`Import complete: ${result.imported} controls imported into "${options.name}"`);

  if (result.frameworkColumns.length > 0) {
    info(`Mapping reference columns found (${result.frameworkColumns.length}): ${result.frameworkColumns.join(', ')}`);
    info(`Total mapping references extracted: ${result.mappingsExtracted}`);
  }

  if (result.errors.length > 0) {
    warn(`${result.errors.length} row(s) had errors and were skipped.`);
  }
}

function runOscalImport(
  options: CatalogImportOptions,
  catalogId: string,
  filePath: string,
  database: import('better-sqlite3').Database
): void {
  const result = importOscalCatalog(filePath, catalogId, database);

  database
    .prepare('UPDATE catalogs SET total_controls = ?, updated_at = ? WHERE id = ?')
    .run(result.imported, now(), catalogId);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
  }

  success(`Import complete: ${result.imported} controls imported into "${options.name}"`);

  if (result.errors.length > 0) {
    warn(`${result.errors.length} row(s) had errors and were skipped.`);
  }
}
