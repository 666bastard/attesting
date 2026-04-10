import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { log } from '../../utils/logger.js';
import type { Catalog } from '../../models/catalog.js';

/**
 * Registers the `attesting catalog list` subcommand.
 */
export function registerCatalogList(catalogCommand: Command): void {
  catalogCommand
    .command('list')
    .description('List all imported catalogs')
    .option('--json', 'Output as JSON')
    .action(runCatalogList);
}

interface CatalogListOptions {
  json?: boolean;
}

function runCatalogList(options: CatalogListOptions): void {
  const database = db.getDb();

  const catalogs = database
    .prepare(
      `SELECT short_name, name, version, publisher, total_controls, source_format, created_at
       FROM catalogs
       ORDER BY created_at ASC`
    )
    .all() as Pick<
    Catalog,
    | 'short_name'
    | 'name'
    | 'version'
    | 'publisher'
    | 'total_controls'
    | 'source_format'
    | 'created_at'
  >[];

  if (options.json) {
    console.log(JSON.stringify(catalogs, null, 2));
    return;
  }

  if (catalogs.length === 0) {
    log('No catalogs imported yet. Use `attesting catalog import` to add one.');
    return;
  }

  // Build column widths dynamically
  const headers = {
    short_name: 'Short Name',
    name: 'Name',
    version: 'Version',
    publisher: 'Publisher',
    total_controls: 'Controls',
    source_format: 'Format',
  };

  const rows = catalogs.map((c) => ({
    short_name: c.short_name,
    name: c.name,
    version: c.version ?? '—',
    publisher: c.publisher ?? '—',
    total_controls: String(c.total_controls),
    source_format: c.source_format ?? '—',
  }));

  type Col = keyof typeof headers;
  const cols: Col[] = [
    'short_name',
    'name',
    'version',
    'publisher',
    'total_controls',
    'source_format',
  ];

  // Calculate column widths (max of header and all row values)
  const widths: Record<Col, number> = {} as Record<Col, number>;
  for (const col of cols) {
    widths[col] = headers[col].length;
    for (const row of rows) {
      widths[col] = Math.max(widths[col], row[col].length);
    }
  }

  const pad = (str: string, width: number): string =>
    str + ' '.repeat(Math.max(0, width - str.length));

  const separator = cols.map((c) => '-'.repeat(widths[c])).join('  ');
  const headerRow = cols.map((c) => pad(headers[c], widths[c])).join('  ');

  log('');
  log(headerRow);
  log(separator);
  for (const row of rows) {
    log(cols.map((c) => pad(row[c], widths[c])).join('  '));
  }
  log('');
}
