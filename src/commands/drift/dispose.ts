import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, error, info } from '../../utils/logger.js';
import { processDispositionInput, commitDisposition } from '../../services/disposition/approval.js';
import readline from 'readline';

/**
 * `attesting drift dispose <alert-id>` — submit a disposition via NLP pipeline.
 */
export function registerDriftDispose(driftCommand: Command): void {
  driftCommand
    .command('dispose <alert-id>')
    .description('Submit a natural-language disposition for a drift alert')
    .option('--text <text>', 'Disposition rationale (or omit for interactive prompt)')
    .option('--analyst <owner-id>', 'Analyst owner ID', 'cli')
    .option('--commit', 'Auto-commit without confirmation')
    .option('--json', 'Output as JSON')
    .action(runDriftDispose);
}

interface DriftDisposeOptions {
  text?: string;
  analyst: string;
  commit?: boolean;
  json?: boolean;
}

async function runDriftDispose(alertId: string, options: DriftDisposeOptions): Promise<void> {
  const database = db.getDb();

  // Verify alert exists
  const alert = database.prepare('SELECT id, title, severity FROM drift_alerts WHERE id = ?').get(alertId) as any;
  if (!alert) {
    error(`Drift alert not found: "${alertId}"`);
    process.exit(1);
  }

  // Get rationale text
  let text = options.text;
  if (!text) {
    console.log(`\n  Alert: [${alert.severity}] ${alert.title}\n`);
    text = await prompt('  Enter disposition rationale: ');
    if (!text.trim()) {
      error('Rationale is required.');
      process.exit(1);
    }
  }

  // Process through NLP pipeline
  try {
    const result = processDispositionInput(database, alertId, options.analyst, text);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!options.commit) return;
    }

    if (!options.json) {
      info(`NLP classification result:\n`);
      console.log(`  Type: ${result.disposition.disposition_type}`);
      console.log(`  Confidence: ${(result.disposition.nlp_confidence * 100).toFixed(0)}%`);
      console.log(`  Approval: ${result.disposition.requires_approval ? 'requires supervisor' : 'self-approved'}`);
      console.log(`  Expires: ${result.disposition.expires_at}`);

      if (result.disposition.auto_tasks.length > 0) {
        console.log(`\n  Auto-generated tasks (${result.disposition.auto_tasks.length}):`);
        for (const task of result.disposition.auto_tasks) {
          console.log(`    - ${task.title ?? task.description ?? JSON.stringify(task)}`);
        }
      }

      if (result.disposition.deferral_target_date) {
        console.log(`  Deferral target: ${result.disposition.deferral_target_date}`);
      }
    }

    // Commit
    if (options.commit || (!options.json && await confirm('\n  Commit this disposition? (y/N) '))) {
      const committed = commitDisposition(database, result.disposition);

      if (options.json) {
        console.log(JSON.stringify(committed, null, 2));
        return;
      }

      success(`Disposition committed (ID: ${committed.disposition_id})`);
      if (committed.task_ids.length > 0) {
        console.log(`  Tasks created: ${committed.task_ids.length}`);
      }
    } else if (!options.json) {
      console.log('  Disposition not committed.');
    }
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}

function prompt(message: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, answer => { rl.close(); resolve(answer); });
  });
}

function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
