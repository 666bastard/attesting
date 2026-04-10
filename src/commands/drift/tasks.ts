import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, warn } from '../../utils/logger.js';

/**
 * `attesting drift tasks` — list auto-generated disposition tasks.
 */
export function registerDriftTasks(driftCommand: Command): void {
  driftCommand
    .command('tasks')
    .description('List disposition tasks')
    .option('--status <status>', 'Filter: open, in_progress, complete, all', 'open')
    .option('--json', 'Output as JSON')
    .action(runDriftTasks);
}

interface DriftTasksOptions {
  status: string;
  json?: boolean;
}

function runDriftTasks(options: DriftTasksOptions): void {
  const database = db.getDb();

  let sql = `
    SELECT dt.*, d.disposition_type, d.drift_alert_id,
           da.title AS alert_title, da.severity AS alert_severity
    FROM disposition_tasks dt
    JOIN dispositions d ON dt.disposition_id = d.id
    JOIN drift_alerts da ON d.drift_alert_id = da.id
  `;
  const params: unknown[] = [];

  if (options.status !== 'all') {
    sql += ' WHERE dt.status = ?';
    params.push(options.status);
  }

  sql += ' ORDER BY da.severity, dt.created_at DESC';

  const tasks = database.prepare(sql).all(...params) as any[];

  if (options.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  if (tasks.length === 0) {
    warn('No disposition tasks found.');
    return;
  }

  info(`${tasks.length} task(s):\n`);
  for (const t of tasks) {
    console.log(`  [${t.status}] ${t.title}`);
    console.log(`    Alert: [${t.alert_severity}] ${t.alert_title}`);
    console.log(`    Disposition: ${t.disposition_type}  Task ID: ${t.id}`);
  }
}
