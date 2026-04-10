import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, warn } from '../../utils/logger.js';

/**
 * `attesting connector list` — list registered connectors.
 */
export function registerConnectorList(connCommand: Command): void {
  connCommand
    .command('list')
    .description('List registered connectors with health and sync status')
    .option('--json', 'Output as JSON')
    .action(runConnectorList);
}

interface ConnectorListOptions {
  json?: boolean;
}

function runConnectorList(options: ConnectorListOptions): void {
  const database = db.getDb();

  const connectors = database.prepare(`
    SELECT c.*,
      (SELECT MAX(csl.started_at) FROM connector_sync_log csl WHERE csl.connector_id = c.id) AS last_sync,
      (SELECT csl.status FROM connector_sync_log csl
       WHERE csl.connector_id = c.id ORDER BY csl.started_at DESC LIMIT 1) AS last_sync_status,
      (SELECT csl.records_processed FROM connector_sync_log csl
       WHERE csl.connector_id = c.id ORDER BY csl.started_at DESC LIMIT 1) AS last_records
    FROM connectors c ORDER BY c.name
  `).all() as any[];

  if (options.json) {
    console.log(JSON.stringify(connectors, null, 2));
    return;
  }

  if (connectors.length === 0) {
    warn('No connectors registered.');
    return;
  }

  info(`${connectors.length} connector(s):\n`);
  for (const c of connectors) {
    const enabled = c.is_enabled ? 'enabled' : 'disabled';
    console.log(`  ${c.name}  (${c.adapter_class})`);
    console.log(`    Health: ${c.health_status}  Status: ${enabled}  Sync mode: ${c.sync_mode}`);
    console.log(`    Last sync: ${c.last_sync ?? 'never'}  Result: ${c.last_sync_status ?? '—'}  Records: ${c.last_records ?? '—'}`);
    console.log(`    ID: ${c.id}`);
  }
}
