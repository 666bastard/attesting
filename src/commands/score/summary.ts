import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, log, warn } from '../../utils/logger.js';
import { getScoresForScope, snapshotScore } from '../../services/scoring/snapshot.js';
import { resolveScope, fmtScore } from './_common.js';

interface SummaryOptions {
  scope?: string;
  compute?: boolean;
  json?: boolean;
}

export function registerScoreSummary(scoreCommand: Command): void {
  scoreCommand
    .command('summary')
    .description('Cross-catalog summary of compliance scores for a scope')
    .option('--scope <ref>', 'Scope name, UUID, or "org" (default: org-wide)')
    .option('--compute', 'Compute snapshots for any catalogs that have none yet')
    .option('--json', 'Output as JSON')
    .action(runSummary);
}

function runSummary(options: SummaryOptions): void {
  const database = db.getDb();
  const scopeId = resolveScope(database, options.scope);

  let scores = getScoresForScope(database, scopeId);

  if (scores.length === 0 && options.compute) {
    const catalogs = database.prepare('SELECT id FROM catalogs').all() as Array<{ id: string }>;
    for (const c of catalogs) {
      snapshotScore(database, c.id, scopeId, { trigger: 'manual' });
    }
    scores = getScoresForScope(database, scopeId);
  }

  if (options.json) {
    console.log(JSON.stringify({ scope_id: scopeId, catalogs: scores }, null, 2));
    return;
  }

  if (scores.length === 0) {
    warn(`No score snapshots for scope "${options.scope ?? 'org-wide'}". Run with --compute to seed.`);
    return;
  }

  info(`Compliance summary — ${options.scope ?? 'org-wide'}`);
  log('');

  let sum = 0;
  for (const s of scores) {
    const label = (s as any).catalog_short_name ?? s.catalog_id.substring(0, 8);
    log(
      `  ${String(label).padEnd(24)} overall=${fmtScore(s.overall_score).padStart(8)}` +
      `  cov=${fmtScore(s.coverage_score).padStart(8)}` +
      `  ev=${fmtScore(s.evidence_score).padStart(8)}` +
      `  as=${fmtScore(s.assessment_score).padStart(8)}`,
    );
    sum += s.overall_score;
  }

  const avg = sum / scores.length;
  log('');
  log(`  Average across ${scores.length} catalog(s): ${fmtScore(avg)}`);
}
