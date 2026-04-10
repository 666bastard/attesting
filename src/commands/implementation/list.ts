import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { log, warn } from '../../utils/logger.js';

/**
 * Registers the `attesting impl list` subcommand.
 */
export function registerImplList(implCommand: Command): void {
  implCommand
    .command('list')
    .description('List implementation statements')
    .option('--catalog <shortName>', 'Filter by catalog short name')
    .option('--scope <name>', 'Filter by scope name')
    .option('--status <status>', 'Filter by implementation status')
    .option('--limit <n>', 'Maximum number of results', '50')
    .option('--json', 'Output as JSON')
    .action(runImplList);
}

interface ImplListOptions {
  catalog?: string;
  scope?: string;
  status?: string;
  limit: string;
  json?: boolean;
}

function runImplList(options: ImplListOptions): void {
  const database = db.getDb();
  const limit = parseInt(options.limit, 10) || 50;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.catalog) {
    conditions.push('cat.short_name = ?');
    params.push(options.catalog);
  }
  if (options.scope) {
    conditions.push('s.name = ?');
    params.push(options.scope);
  }
  if (options.status) {
    conditions.push('i.status = ?');
    params.push(options.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      c.control_id,
      cat.short_name AS catalog,
      i.status,
      i.sig_response,
      i.statement
    FROM implementations i
    JOIN controls c   ON i.primary_control_id = c.id
    JOIN catalogs cat ON c.catalog_id = cat.id
    LEFT JOIN scopes s ON i.scope_id = s.id
    ${whereClause}
    ORDER BY cat.short_name, c.control_id
    LIMIT ?
  `;

  interface ImplRow {
    control_id: string;
    catalog: string;
    status: string;
    sig_response: string | null;
    statement: string | null;
  }

  const rows = database.prepare(sql).all(...params, limit) as ImplRow[];

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    warn('No implementations found.');
    return;
  }

  // Column widths for tabular output
  const COL_ID = 18;
  const COL_CATALOG = 20;
  const COL_STATUS = 24;
  const COL_RESP = 5;
  const COL_STMT = 60;

  function pad(s: string, width: number): string {
    if (s.length >= width) return s.slice(0, width);
    return s + ' '.repeat(width - s.length);
  }

  const header =
    pad('control_id', COL_ID) +
    '  ' +
    pad('catalog', COL_CATALOG) +
    '  ' +
    pad('status', COL_STATUS) +
    '  ' +
    pad('resp', COL_RESP) +
    '  ' +
    'statement';

  log('');
  log(header);
  log('-'.repeat(header.length));

  for (const row of rows) {
    const stmt = (row.statement ?? '').slice(0, COL_STMT);
    log(
      pad(row.control_id, COL_ID) +
        '  ' +
        pad(row.catalog, COL_CATALOG) +
        '  ' +
        pad(row.status, COL_STATUS) +
        '  ' +
        pad(row.sig_response ?? '-', COL_RESP) +
        '  ' +
        stmt
    );
  }

  log('');
  log(`${rows.length} implementation(s) shown.`);
}
