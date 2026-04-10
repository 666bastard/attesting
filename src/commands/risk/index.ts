import { Command } from 'commander';
import { registerRiskList } from './list.js';
import { registerRiskCreate } from './create.js';
import { registerRiskUpdate } from './update.js';
import { registerRiskLink } from './link.js';
import { registerRiskExceptions } from './exceptions.js';
import { registerRiskMatrix } from './matrix.js';

/**
 * Registers the `attesting risk` command group with all subcommands.
 */
export function registerRiskCommands(program: Command): void {
  const riskCommand = program
    .command('risk')
    .description('Manage the risk register');

  registerRiskList(riskCommand);
  registerRiskCreate(riskCommand);
  registerRiskUpdate(riskCommand);
  registerRiskLink(riskCommand);
  registerRiskExceptions(riskCommand);
  registerRiskMatrix(riskCommand);
}
