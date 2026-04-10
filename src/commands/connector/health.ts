import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, error, info } from '../../utils/logger.js';
import { AdapterRegistry } from '../../services/connectors/registry.js';

const registry = new AdapterRegistry();

/**
 * `attesting connector health [id]` — check adapter health.
 */
export function registerConnectorHealth(connCommand: Command): void {
  connCommand
    .command('health [id]')
    .description('Check adapter health (connectivity, auth, API availability)')
    .option('--json', 'Output as JSON')
    .action(runConnectorHealth);
}

interface ConnectorHealthOptions {
  json?: boolean;
}

async function runConnectorHealth(id: string | undefined, options: ConnectorHealthOptions): Promise<void> {
  const database = db.getDb();

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

  if (!options.json) {
    info(`Checking health for ${connectors.length} connector(s)...\n`);
  }

  const results: any[] = [];

  for (const conn of connectors) {
    try {
      const adapter = registry.create(database, conn);
      const result = await adapter.healthcheck();

      database.prepare(
        "UPDATE connectors SET health_status = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(result.status ?? 'healthy', conn.id);

      results.push({ id: conn.id, name: conn.name, ...result });

      if (!options.json) {
        if (result.status === 'healthy' || result.status === 'ok') {
          success(`  ${conn.name}: ${result.status}`);
        } else {
          error(`  ${conn.name}: ${result.status} — ${result.error ?? ''}`);
        }
      }
    } catch (err: any) {
      database.prepare(
        "UPDATE connectors SET health_status = 'error', updated_at = datetime('now') WHERE id = ?"
      ).run(conn.id);

      results.push({ id: conn.id, name: conn.name, status: 'error', error: err.message });

      if (!options.json) {
        error(`  ${conn.name}: ${err.message}`);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  }
}
