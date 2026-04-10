import { Command } from 'commander';
import { registerDriftList } from './list.js';
import { registerDriftCheck } from './check.js';
import { registerDriftDispose } from './dispose.js';
import { registerDriftTasks } from './tasks.js';
import { registerDriftSchedule } from './schedule.js';

/**
 * Registers the `attesting drift` command group with all subcommands.
 */
export function registerDriftCommands(program: Command): void {
  const driftCommand = program
    .command('drift')
    .description('Manage drift detection and dispositions');

  registerDriftList(driftCommand);
  registerDriftCheck(driftCommand);
  registerDriftDispose(driftCommand);
  registerDriftTasks(driftCommand);
  registerDriftSchedule(driftCommand);
}
