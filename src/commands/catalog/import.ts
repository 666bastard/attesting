import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn } from '../../utils/logger.js';
import { importCsvCatalog, type ColumnMapping } from '../../importers/csv-generic.js';
import { importSigCatalog } from '../../importers/sig-content-library.js';
import { importOscalCatalog } from '../../importers/oscal-catalog.js';
import type { Catalog } from '../../models/catalog.js';

/**
 * Registers the `attesting catalog import` subcommand.
 */
export function registerCatalogImport(catalogCommand: Command): void {
  catalogCommand
    .command('import')
    .description('Import a control catalog from a file')
    .requiredOption('--file <file>', 'Path to the source file')
    .option('--format <format>', 'Import format: csv | sig | oscal (auto-detected from extension)')
    .option('--name <name>', 'Catalog display name (auto-detected from OSCAL metadata)')
    .option('--short-name <shortName>', 'Unique short identifier (default: filename without extension)')
    .option('--columns <mapping>', 'Column mapping for CSV: "control_id=A,title=B,description=C"')
    .option('--publisher <publisher>', 'Publisher name (auto-detected from OSCAL metadata.props)')
    .option('--catalog-version <version>', 'Catalog version string')
    .option('--scope-level <level>', 'SIG scope level filter: Lite | Core | Detail')
    .option('--json', 'Output as JSON')
    .action(runCatalogImport);
}

interface CatalogImportOptions {
  format?: string;
  file: string;
  name?: string;
  shortName?: string;
  columns?: string;
  publisher?: string;
  catalogVersion?: string;
  scopeLevel?: string;
  json?: boolean;
}

interface OscalMetaProp { name: string; value: string }
interface OscalDocLite { catalog?: { metadata?: { title?: string; props?: OscalMetaProp[] } } }

const SUPPORTED_FORMATS = ['csv', 'sig', 'oscal'] as const;

interface ResolvedOptions {
  format: string;
  name: string;
  shortName: string;
  publisher: string | null;
}

/**
 * Auto-detect format/name/shortName/publisher from the file extension and,
 * for OSCAL JSON, from `catalog.metadata`. Falls back to whatever the user
 * passed explicitly. Exits the process on unrecoverable detection errors.
 */
function resolveOptions(options: CatalogImportOptions, filePath: string): ResolvedOptions {
  const ext = path.extname(filePath).toLowerCase();
  let format = options.format?.toLowerCase();
  let oscalDoc: OscalDocLite | null = null;

  if (ext === '.json') {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as OscalDocLite;
      if (parsed?.catalog?.metadata) {
        oscalDoc = parsed;
        format ??= 'oscal';
      }
    } catch (err) {
      if (!format) {
        error(`Could not parse JSON file: ${(err as Error).message}`);
        process.exit(1);
      }
    }
  } else if (ext === '.csv' && !format) {
    format = 'csv';
  }

  if (!format) {
    error(`Could not detect format from "${path.basename(filePath)}". Pass --format explicitly.`);
    process.exit(1);
  }
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(format)) {
    error(`Unsupported format "${format}". Supported: ${SUPPORTED_FORMATS.join(', ')}`);
    process.exit(1);
  }

  const shortName = options.shortName ?? path.basename(filePath, path.extname(filePath)).toLowerCase();
  const name = options.name ?? oscalDoc?.catalog?.metadata?.title ?? shortName;
  const publisher = options.publisher
    ?? oscalDoc?.catalog?.metadata?.props?.find((p) => p.name === 'publisher')?.value
    ?? null;

  return { format, name, shortName, publisher };
}

async function runCatalogImport(options: CatalogImportOptions): Promise<void> {
  const filePath = path.resolve(options.file);

  if (!fs.existsSync(filePath)) {
    error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const resolved = resolveOptions(options, filePath);
  const database = db.getDb();

  // Check for duplicate short_name
  const existing = database
    .prepare('SELECT id, name FROM catalogs WHERE short_name = ?')
    .get(resolved.shortName) as Pick<Catalog, 'id' | 'name'> | undefined;

  if (existing) {
    error(
      `A catalog with short-name "${resolved.shortName}" already exists: "${existing.name}". ` +
        'Use a unique --short-name.'
    );
    process.exit(1);
  }

  // Create the catalog record
  const catalogId = generateUuid();
  const timestamp = now();
  const sourceFormat = resolved.format === 'sig' ? 'sig-xlsm' : resolved.format;

  database
    .prepare(
      `INSERT INTO catalogs (id, name, short_name, version, source_format, publisher, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      catalogId,
      resolved.name,
      resolved.shortName,
      options.catalogVersion ?? null,
      sourceFormat,
      resolved.publisher,
      timestamp,
      timestamp
    );

  info(`Importing catalog: ${resolved.name} (${resolved.shortName})`);
  info(`Source file: ${filePath}`);

  if (resolved.format === 'csv') {
    runCsvImport(options, resolved, catalogId, filePath, database);
  } else if (resolved.format === 'sig') {
    await runSigImport(options, resolved, catalogId, filePath, database);
  } else if (resolved.format === 'oscal') {
    runOscalImport(options, resolved, catalogId, filePath, database);
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
  resolved: ResolvedOptions,
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

  if (options.json) {
    console.log(JSON.stringify({ catalog: resolved.shortName, imported: result.imported, errors: result.errors }, null, 2));
    return;
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
  }

  success(`Import complete: ${result.imported} controls imported into "${resolved.name}"`);

  if (result.errors.length > 0) {
    warn(`${result.errors.length} row(s) had errors and were skipped.`);
  }
}

async function runSigImport(
  options: CatalogImportOptions,
  resolved: ResolvedOptions,
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

  if (options.json) {
    console.log(JSON.stringify({
      catalog: resolved.shortName,
      imported: result.imported,
      framework_columns: result.frameworkColumns,
      mappings_extracted: result.mappingsExtracted,
      errors: result.errors,
    }, null, 2));
    return;
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
  }

  success(`Import complete: ${result.imported} controls imported into "${resolved.name}"`);

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
  resolved: ResolvedOptions,
  catalogId: string,
  filePath: string,
  database: import('better-sqlite3').Database
): void {
  const result = importOscalCatalog(filePath, catalogId, database);

  database
    .prepare('UPDATE catalogs SET total_controls = ?, updated_at = ? WHERE id = ?')
    .run(result.imported, now(), catalogId);

  if (options.json) {
    console.log(JSON.stringify({ catalog: resolved.shortName, imported: result.imported, errors: result.errors }, null, 2));
    return;
  }

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      error(err);
    }
  }

  success(`Import complete: ${result.imported} controls imported into "${resolved.name}"`);

  if (result.errors.length > 0) {
    warn(`${result.errors.length} row(s) had errors and were skipped.`);
  }
}
