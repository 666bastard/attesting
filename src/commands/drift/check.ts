import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, success, error } from '../../utils/logger.js';
import { DriftScheduler } from '../../services/drift/scheduler.js';

/**
 * `attesting drift check [name]` — run drift checks on demand.
 */
export function registerDriftCheck(driftCommand: Command): void {
  driftCommand
    .command('check [name]')
    .description('Run drift checks on demand (all or a specific check by name)')
    .option('--json', 'Output as JSON')
    .action(runDriftCheck);
}

interface DriftCheckOptions {
  json?: boolean;
}

function runDriftCheck(name: string | undefined, options: DriftCheckOptions): void {
  const database = db.getDb();
  const scheduler = new DriftScheduler(database);
  const checks = scheduler.listChecks();

  if (name) {
    if (!checks.includes(name)) {
      error(`Unknown check: "${name}". Available: ${checks.join(', ')}`);
      process.exit(1);
    }

    const result = scheduler.runOnce(name);

    if (options.json) {
      console.log(JSON.stringify({ check: name, result }, null, 2));
      return;
    }

    success(`${name}: ${JSON.stringify(result)}`);
    return;
  }

  // Run all checks
  info(`Running all ${checks.length} drift checks...\n`);
  const results: Record<string, unknown> = {};

  for (const check of checks) {
    try {
      const result = scheduler.runOnce(check);
      results[check] = result;
      if (!options.json) {
        success(`  ${check}: ${JSON.stringify(result)}`);
      }
    } catch (err: any) {
      results[check] = { error: err.message };
      if (!options.json) {
        error(`  ${check}: ${err.message}`);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  }
}
