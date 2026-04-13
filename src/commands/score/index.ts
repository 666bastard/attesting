import { Command } from 'commander';
import { registerScoreShow } from './show.js';
import { registerScoreSnapshot } from './snapshot.js';
import { registerScoreHistory } from './history.js';
import { registerScoreSummary } from './summary.js';

/** Registers the `attesting score` command group. */
export function registerScoreCommands(program: Command): void {
  const scoreCommand = program
    .command('score')
    .description('Compliance scoring — compute, snapshot, and inspect scores');

  registerScoreShow(scoreCommand);
  registerScoreSnapshot(scoreCommand);
  registerScoreHistory(scoreCommand);
  registerScoreSummary(scoreCommand);
}
