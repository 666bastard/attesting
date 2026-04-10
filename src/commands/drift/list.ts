import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, warn } from '../../utils/logger.js';

/**
 * `attesting drift list` — list drift alerts with filters.
 */
export function registerDriftList(driftCommand: Command): void {
  driftCommand
    .command('list')
    .description('List drift alerts')
    .option('--status <status>', 'Filter: active, resolved, suppressed, all', 'active')
    .option('--severity <severity>', 'Filter by severity (low, medium, high, critical)')
    .option('--type <type>', 'Filter by alert_type')
    .option('--since <date>', 'Only show alerts detected after this date')
    .option('--json', 'Output as JSON')
    .action(runDriftList);
}

interface DriftListOptions {
  status: string;
  severity?: string;
  type?: string;
  since?: string;
  json?: boolean;
}

function runDriftList(options: DriftListOptions): void {
  const database = db.getDb();

  let sql: string;
  const params: unknown[] = [];

  if (options.status === 'active') {
    sql = `SELECT * FROM drift_alerts
           WHERE resolved_at IS NULL
           AND (suppressed_until IS NULL OR suppressed_until < datetime('now'))`;
  } else if (options.status === 'resolved') {
    sql = 'SELECT * FROM drift_alerts WHERE resolved_at IS NOT NULL';
  } else if (options.status === 'suppressed') {
    sql = `SELECT * FROM drift_alerts WHERE suppressed_until IS NOT NULL AND suppressed_until >= datetime('now')`;
  } else {
    sql = 'SELECT * FROM drift_alerts WHERE 1=1';
  }

  if (options.severity) {
    sql += ' AND severity = ?';
    params.push(options.severity);
  }
  if (options.type) {
    sql += ' AND alert_type = ?';
    params.push(options.type);
  }
  if (options.since) {
    sql += ' AND detected_at >= ?';
    params.push(options.since);
  }

  sql += ` ORDER BY
    CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2
         WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
    detected_at DESC`;

  const alerts = database.prepare(sql).all(...params) as any[];

  if (options.json) {
    console.log(JSON.stringify(alerts, null, 2));
    return;
  }

  if (alerts.length === 0) {
    warn('No drift alerts found matching filters.');
    return;
  }

  info(`${alerts.length} drift alert(s):\n`);
  for (const a of alerts) {
    console.log(`  [${a.severity}] ${a.title}`);
    console.log(`    Type: ${a.alert_type}  Detected: ${a.detected_at}  ID: ${a.id}`);
  }
}
