import { Command } from 'commander';
import { registerIntelList } from './list.js';
import { registerIntelSubmit } from './submit.js';
import { registerIntelPromote } from './promote.js';
import { registerIntelCorroborate } from './corroborate.js';
import { registerIntelShadow } from './shadow.js';

/**
 * Registers the `attesting intel` command group with all subcommands.
 */
export function registerIntelCommands(program: Command): void {
  const intelCommand = program
    .command('intel')
    .description('Manage threat intelligence');

  registerIntelList(intelCommand);
  registerIntelSubmit(intelCommand);
  registerIntelPromote(intelCommand);
  registerIntelCorroborate(intelCommand);
  registerIntelShadow(intelCommand);
}
