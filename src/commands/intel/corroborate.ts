import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, success, warn } from '../../utils/logger.js';
import { checkAutoCorroboration } from '../../services/intel/auto-corroboration.js';

/**
 * `attesting intel corroborate` — run auto-corroboration on demand.
 * Checks all recent threat inputs against provisional manual intel.
 */
export function registerIntelCorroborate(intelCommand: Command): void {
  intelCommand
    .command('corroborate')
    .description('Run auto-corroboration against all provisional intel')
    .option('--since <date>', 'Only check threats ingested after this date (YYYY-MM-DD)')
    .option('--json', 'Output as JSON')
    .action(runIntelCorroborate);
}

interface IntelCorroborateOptions {
  since?: string;
  json?: boolean;
}

function runIntelCorroborate(options: IntelCorroborateOptions): void {
  const database = db.getDb();

  // Get provisional intel count
  const provisionalCount = (database.prepare(
    "SELECT COUNT(*) AS c FROM manual_intel WHERE status IN ('provisional', 'watching')"
  ).get() as { c: number }).c;

  if (provisionalCount === 0) {
    warn('No provisional intel to corroborate.');
    return;
  }

  // Get recent threats to check against
  let threatSql = 'SELECT id, title FROM threat_inputs';
  const params: unknown[] = [];
  if (options.since) {
    threatSql += ' WHERE ingested_at >= ?';
    params.push(options.since);
  }
  threatSql += ' ORDER BY ingested_at DESC';

  const threats = database.prepare(threatSql).all(...params) as Array<{ id: string; title: string }>;

  if (threats.length === 0) {
    warn('No threat inputs found to check against.');
    return;
  }

  info(`Checking ${threats.length} threat(s) against ${provisionalCount} provisional intel entry/entries...\n`);

  const allMatches: any[] = [];
  for (const threat of threats) {
    const matches = checkAutoCorroboration(database, threat.id);
    allMatches.push(...matches);
  }

  if (options.json) {
    console.log(JSON.stringify(allMatches, null, 2));
    return;
  }

  if (allMatches.length === 0) {
    warn('No corroboration matches found.');
    return;
  }

  success(`${allMatches.length} corroboration match(es) found:\n`);
  for (const m of allMatches) {
    console.log(`  ${m.manual_intel_title}`);
    console.log(`    Matched threat: ${m.threat_title}`);
    console.log(`    Reasons: ${m.match_reasons.join(', ')}`);
    console.log(`    Intel ID: ${m.manual_intel_id}  Threat ID: ${m.threat_id}`);
  }
}
