import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, warn } from '../../utils/logger.js';

/**
 * `attesting intel list` — list threat_inputs with filters.
 */
export function registerIntelList(intelCommand: Command): void {
  intelCommand
    .command('list')
    .description('List threat intelligence entries')
    .option('--source <channel>', 'Filter by channel (manual, cisa_kev, nvd, etc.)')
    .option('--severity <severity>', 'Filter by severity (info, low, medium, high, critical)')
    .option('--type <type>', 'Filter by threat_type (vulnerability, exploit, campaign, etc.)')
    .option('--since <date>', 'Only show entries ingested after this date (YYYY-MM-DD)')
    .option('--manual', 'Show manual_intel entries instead of threat_inputs')
    .option('--json', 'Output as JSON')
    .action(runIntelList);
}

interface IntelListOptions {
  source?: string;
  severity?: string;
  type?: string;
  since?: string;
  manual?: boolean;
  json?: boolean;
}

function runIntelList(options: IntelListOptions): void {
  const database = db.getDb();

  if (options.manual) {
    listManualIntel(database, options);
    return;
  }

  let sql = 'SELECT * FROM threat_inputs WHERE 1=1';
  const params: unknown[] = [];

  if (options.source) {
    sql += ' AND channel = ?';
    params.push(options.source);
  }
  if (options.severity) {
    sql += ' AND severity = ?';
    params.push(options.severity);
  }
  if (options.type) {
    sql += ' AND threat_type = ?';
    params.push(options.type);
  }
  if (options.since) {
    sql += ' AND ingested_at >= ?';
    params.push(options.since);
  }

  sql += ' ORDER BY ingested_at DESC LIMIT 100';

  const rows = database.prepare(sql).all(...params) as any[];

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    warn('No threat inputs found matching filters.');
    return;
  }

  info(`${rows.length} threat input(s):\n`);
  for (const r of rows) {
    console.log(`  [${r.severity}] ${r.title}`);
    console.log(`    Channel: ${r.channel}  Type: ${r.threat_type}  CVE: ${r.cve_id ?? '—'}  Ingested: ${r.ingested_at}`);
  }
}

function listManualIntel(database: any, options: IntelListOptions): void {
  let sql = 'SELECT * FROM manual_intel WHERE 1=1';
  const params: unknown[] = [];

  if (options.severity) {
    sql += ' AND severity_estimate = ?';
    params.push(options.severity);
  }
  if (options.since) {
    sql += ' AND created_at >= ?';
    params.push(options.since);
  }

  sql += ' ORDER BY created_at DESC LIMIT 100';

  const rows = database.prepare(sql).all(...params) as any[];

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    warn('No manual intel entries found.');
    return;
  }

  info(`${rows.length} manual intel entry/entries:\n`);
  for (const r of rows) {
    console.log(`  [${r.severity_estimate}] ${r.title}  (${r.status})`);
    console.log(`    Confidence: ${r.confidence_level}  Deadline: ${r.corroboration_deadline}  ID: ${r.id}`);
  }
}
