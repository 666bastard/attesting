import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { log, error } from '../../utils/logger.js';
import type { Catalog } from '../../models/catalog.js';
import type { Control } from '../../models/control.js';

const DEFAULT_LIMIT = 20;
const DESCRIPTION_MAX_LENGTH = 80;

/**
 * Registers the `attesting catalog inspect <short-name>` subcommand.
 */
export function registerCatalogInspect(catalogCommand: Command): void {
  catalogCommand
    .command('inspect <shortName>')
    .description('Show controls in a catalog')
    .option('--limit <n>', 'Maximum number of controls to display', String(DEFAULT_LIMIT))
    .option('--search <text>', 'Full-text search within the catalog')
    .option('--json', 'Output as JSON')
    .action(runCatalogInspect);
}

interface InspectOptions {
  limit: string;
  search?: string;
  json?: boolean;
}

type ControlRow = Pick<Control, 'control_id' | 'title' | 'description'>;

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function runCatalogInspect(shortName: string, options: InspectOptions): void {
  const database = db.getDb();

  const limit = parseInt(options.limit, 10);
  if (isNaN(limit) || limit < 1) {
    error('--limit must be a positive integer');
    process.exit(1);
  }

  // Look up the catalog
  const catalog = database
    .prepare('SELECT id, name, total_controls FROM catalogs WHERE short_name = ?')
    .get(shortName) as Pick<Catalog, 'id' | 'name' | 'total_controls'> | undefined;

  if (!catalog) {
    error(`Catalog not found: "${shortName}". Use \`attesting catalog list\` to see available catalogs.`);
    process.exit(1);
  }

  let controls: ControlRow[];

  if (options.search) {
    // Use FTS5 for full-text search within this catalog
    controls = database
      .prepare(
        `SELECT c.control_id, c.title, c.description
         FROM controls_fts fts
         JOIN controls c ON c.rowid = fts.rowid
         WHERE c.catalog_id = ?
           AND controls_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(catalog.id, options.search, limit) as ControlRow[];
  } else {
    controls = database
      .prepare(
        `SELECT control_id, title, description
         FROM controls
         WHERE catalog_id = ?
         ORDER BY sort_order ASC, control_id ASC
         LIMIT ?`
      )
      .all(catalog.id, limit) as ControlRow[];
  }

  if (options.json) {
    console.log(JSON.stringify(controls, null, 2));
    return;
  }

  log(`\nCatalog: ${catalog.name}  (${catalog.total_controls} total controls)`);
  if (options.search) {
    log(`Search: "${options.search}"`);
  }
  log(`Showing up to ${limit} controls\n`);

  if (controls.length === 0) {
    log('No controls found.');
    return;
  }

  // Header
  const idWidth = 16;
  const titleWidth = 28;
  const descWidth = DESCRIPTION_MAX_LENGTH;

  const pad = (s: string, w: number): string =>
    s.length > w ? s.slice(0, w - 1) + '…' : s + ' '.repeat(w - s.length);

  log(
    `${pad('Control ID', idWidth)}  ${pad('Title', titleWidth)}  Description`
  );
  log(
    `${'-'.repeat(idWidth)}  ${'-'.repeat(titleWidth)}  ${'-'.repeat(descWidth)}`
  );

  for (const ctrl of controls) {
    const id = pad(ctrl.control_id, idWidth);
    const title = pad(ctrl.title, titleWidth);
    const desc = truncate(ctrl.description, descWidth);
    log(`${id}  ${title}  ${desc}`);
  }
  log('');
}
