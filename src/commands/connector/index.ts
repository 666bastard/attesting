import { Command } from 'commander';
import { registerConnectorList } from './list.js';
import { registerConnectorAdd } from './add.js';
import { registerConnectorSync } from './sync.js';
import { registerConnectorLog } from './log.js';
import { registerConnectorHealth } from './health.js';

/**
 * Registers the `attesting connector` command group with all subcommands.
 */
export function registerConnectorCommands(program: Command): void {
  const connCommand = program
    .command('connector')
    .description('Manage external connectors and integrations');

  registerConnectorList(connCommand);
  registerConnectorAdd(connCommand);
  registerConnectorSync(connCommand);
  registerConnectorLog(connCommand);
  registerConnectorHealth(connCommand);
}
