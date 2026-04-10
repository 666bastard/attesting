import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error } from '../../utils/logger.js';
import { AdapterRegistry } from '../../services/connectors/registry.js';

const registry = new AdapterRegistry();

/**
 * `attesting connector add` — register a new connector.
 */
export function registerConnectorAdd(connCommand: Command): void {
  connCommand
    .command('add')
    .description('Register a new connector')
    .requiredOption('--name <name>', 'Connector display name')
    .requiredOption('--type <adapter-class>', 'Adapter class (e.g. CISAKEVAdapter)')
    .option('--connector-type <type>', 'Connector type (threat_feed, asset_inventory, siem, ticketing, identity, cloud_provider, etc.)', 'threat_feed')
    .option('--direction <dir>', 'Direction: inbound, outbound, bidirectional', 'inbound')
    .option('--config <json>', 'Configuration JSON string')
    .option('--sync-mode <mode>', 'Sync mode: manual, scheduled', 'manual')
    .option('--sync-interval <minutes>', 'Sync interval in minutes (for scheduled mode)')
    .option('--json', 'Output as JSON')
    .action(runConnectorAdd);
}

interface ConnectorAddOptions {
  name: string;
  type: string;
  connectorType: string;
  direction: string;
  config?: string;
  syncMode: string;
  syncInterval?: string;
  json?: boolean;
}

function runConnectorAdd(options: ConnectorAddOptions): void {
  const database = db.getDb();

  // Validate adapter exists
  const available = registry.list();
  if (!available.includes(options.type)) {
    error(`Unknown adapter: "${options.type}". Available: ${available.join(', ')}`);
    process.exit(1);
  }

  // Validate config JSON if provided
  let configStr: string | null = null;
  if (options.config) {
    try {
      JSON.parse(options.config);
      configStr = options.config;
    } catch {
      error('Invalid config JSON.');
      process.exit(1);
    }
  }

  const id = generateUuid();
  const ts = now();

  database.prepare(`
    INSERT INTO connectors (id, name, connector_type, direction, target_module,
      adapter_class, config, auth_method, sync_mode, sync_interval,
      is_enabled, health_status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,'unknown',?,?)
  `).run(
    id, options.name, options.connectorType, options.direction,
    'multi', options.type, configStr, 'api_key',
    options.syncMode, options.syncInterval ? parseInt(options.syncInterval, 10) : null,
    ts, ts
  );

  if (options.json) {
    console.log(JSON.stringify({ id, name: options.name, adapter_class: options.type }));
    return;
  }

  success(`Connector registered: "${options.name}" (ID: ${id})`);
  console.log(`  Adapter: ${options.type}  Sync: ${options.syncMode}`);
}
