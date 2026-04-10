import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info } from '../../utils/logger.js';
import { DriftScheduler } from '../../services/drift/scheduler.js';

// Default intervals in minutes (matches scheduler.ts)
const DEFAULT_INTERVALS: Record<string, number> = {
  evidence_staleness: 5,
  policy_reviews: 60,
  risk_exceptions: 60,
  disposition_expiry: 60,
  manual_intel_expiry: 60,
  posture_recalc: 1440,
};

/**
 * `attesting drift schedule` — show or configure scheduler intervals.
 */
export function registerDriftSchedule(driftCommand: Command): void {
  driftCommand
    .command('schedule')
    .description('Show drift check schedule and intervals')
    .option('--json', 'Output as JSON')
    .action(runDriftSchedule);
}

interface DriftScheduleOptions {
  json?: boolean;
}

function runDriftSchedule(options: DriftScheduleOptions): void {
  const database = db.getDb();
  const scheduler = new DriftScheduler(database);
  const checks = scheduler.listChecks();

  const schedule = checks.map(name => ({
    check: name,
    interval_minutes: DEFAULT_INTERVALS[name] ?? 60,
    interval_human: formatInterval(DEFAULT_INTERVALS[name] ?? 60),
  }));

  if (options.json) {
    console.log(JSON.stringify(schedule, null, 2));
    return;
  }

  info('Drift check schedule:\n');
  for (const s of schedule) {
    console.log(`  ${s.check.padEnd(24)} every ${s.interval_human}`);
  }
}

function formatInterval(minutes: number): string {
  if (minutes >= 1440) return `${minutes / 1440}d`;
  if (minutes >= 60) return `${minutes / 60}h`;
  return `${minutes}m`;
}
