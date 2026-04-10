import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, error, info } from '../../utils/logger.js';
import { AdapterRegistry } from '../../services/connectors/registry.js';
import { propagate } from '../../services/propagation/dispatcher.js';
import type { Actor } from '../../services/audit/logger.js';

const registry = new AdapterRegistry();
const CLI_ACTOR: Actor = { type: 'user', id: 'cli' };

/**
 * `attesting connector sync [id]` — trigger sync.
 */
export function registerConnectorSync(connCommand: Command): void {
  connCommand
    .command('sync [id]')
    .description('Trigger sync for a specific connector or all connectors')
    .option('--full', 'Run full sync instead of incremental')
    .option('--json', 'Output as JSON')
    .action(runConnectorSync);
}

interface ConnectorSyncOptions {
  full?: boolean;
  json?: boolean;
}

async function runConnectorSync(id: string | undefined, options: ConnectorSyncOptions): Promise<void> {
  const database = db.getDb();
  const syncType = options.full ? 'full' : 'incremental';

  let connectors: any[];
  if (id) {
    const conn = database.prepare('SELECT * FROM connectors WHERE id = ?').get(id) as any;
    if (!conn) {
      error(`Connector not found: "${id}"`);
      process.exit(1);
    }
    connectors = [conn];
  } else {
    connectors = database.prepare('SELECT * FROM connectors WHERE is_enabled = 1').all() as any[];
    if (connectors.length === 0) {
      error('No enabled connectors found.');
      process.exit(1);
    }
  }

  const results: any[] = [];

  for (const conn of connectors) {
    if (!options.json) {
      info(`Syncing ${conn.name} (${conn.adapter_class})...`);
    }

    try {
      const adapter = registry.create(database, conn);
      const stats = await adapter.sync(syncType as any);
      results.push({ id: conn.id, name: conn.name, status: 'success', stats });

      propagate(database, 'connector', conn.id, 'sync', CLI_ACTOR, null, { syncType, stats });

      if (!options.json) {
        success(`  ${conn.name}: ${JSON.stringify(stats)}`);
      }
    } catch (err: any) {
      results.push({ id: conn.id, name: conn.name, status: 'failed', error: err.message });
      if (!options.json) {
        error(`  ${conn.name}: ${err.message}`);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  }
}
