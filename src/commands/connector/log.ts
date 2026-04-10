import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, warn } from '../../utils/logger.js';

/**
 * `attesting connector log [id]` — show sync history.
 */
export function registerConnectorLog(connCommand: Command): void {
  connCommand
    .command('log [id]')
    .description('Show sync history from connector_sync_log')
    .option('--limit <n>', 'Number of entries to show', '20')
    .option('--status <status>', 'Filter by status (success, failed)')
    .option('--json', 'Output as JSON')
    .action(runConnectorLog);
}

interface ConnectorLogOptions {
  limit: string;
  status?: string;
  json?: boolean;
}

function runConnectorLog(id: string | undefined, options: ConnectorLogOptions): void {
  const database = db.getDb();
  const limit = Math.min(100, parseInt(options.limit, 10) || 20);

  let sql = `
    SELECT csl.*, c.name AS connector_name
    FROM connector_sync_log csl
    JOIN connectors c ON csl.connector_id = c.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (id) {
    sql += ' AND csl.connector_id = ?';
    params.push(id);
  }
  if (options.status) {
    sql += ' AND csl.status = ?';
    params.push(options.status);
  }

  sql += ' ORDER BY csl.started_at DESC LIMIT ?';
  params.push(limit);

  const logs = database.prepare(sql).all(...params) as any[];

  if (options.json) {
    console.log(JSON.stringify(logs, null, 2));
    return;
  }

  if (logs.length === 0) {
    warn('No sync log entries found.');
    return;
  }

  info(`${logs.length} sync log entry/entries:\n`);
  for (const l of logs) {
    const duration = l.duration_ms ? `${l.duration_ms}ms` : '—';
    console.log(`  [${l.status}] ${l.connector_name}  ${l.started_at}  ${duration}`);
    console.log(`    Records: ${l.records_processed ?? 0}  Errors: ${l.errors ?? 0}  Type: ${l.sync_type}`);
  }
}
