import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { log, warn } from '../../utils/logger.js';

/**
 * Registers the `attesting mapping list` subcommand.
 */
export function registerMappingList(mappingCommand: Command): void {
  mappingCommand
    .command('list')
    .description('List control mappings')
    .option('--source <catalog>', 'Filter by source catalog short name')
    .option('--target <catalog>', 'Filter by target catalog short name')
    .option('--limit <n>', 'Maximum number of results', '50')
    .option('--json', 'Output as JSON')
    .action(runMappingList);
}

interface MappingListOptions {
  source?: string;
  target?: string;
  limit: string;
  json?: boolean;
}

function runMappingList(options: MappingListOptions): void {
  const database = db.getDb();
  const limit = parseInt(options.limit, 10) || 50;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.source) {
    conditions.push('source_catalog = ?');
    params.push(options.source);
  }
  if (options.target) {
    conditions.push('target_catalog = ?');
    params.push(options.target);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      source_catalog,
      source_control_id,
      target_catalog,
      target_control_id,
      relationship,
      confidence
    FROM v_control_mappings
    ${whereClause}
    ORDER BY source_catalog, source_control_id
    LIMIT ?
  `;

  interface MappingRow {
    source_catalog: string;
    source_control_id: string;
    target_catalog: string;
    target_control_id: string;
    relationship: string;
    confidence: string;
  }

  const rows = database.prepare(sql).all(...params, limit) as MappingRow[];

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    warn('No mappings found.');
    return;
  }

  log('');
  for (const row of rows) {
    log(
      `  ${row.source_catalog}:${row.source_control_id} → ${row.target_catalog}:${row.target_control_id}` +
        `  (${row.relationship}, ${row.confidence})`
    );
  }
  log('');
  log(`${rows.length} mapping(s) shown.`);
}
