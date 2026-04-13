import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, log, warn } from '../../utils/logger.js';
import { getScoreHistory } from '../../services/scoring/snapshot.js';
import { resolveCatalog, resolveScope, fmtScore } from './_common.js';

interface HistoryOptions {
  catalog: string;
  scope?: string;
  days?: string;
  json?: boolean;
}

export function registerScoreHistory(scoreCommand: Command): void {
  scoreCommand
    .command('history')
    .description('Show score trend for a catalog + scope')
    .requiredOption('--catalog <ref>', 'Catalog short_name or UUID')
    .option('--scope <ref>', 'Scope name, UUID, or "org" (default: org-wide)')
    .option('--days <n>', 'Lookback window in days (default 90)', '90')
    .option('--json', 'Output as JSON')
    .action(runHistory);
}

function runHistory(options: HistoryOptions): void {
  const database = db.getDb();
  const catalog = resolveCatalog(database, options.catalog);
  const scopeId = resolveScope(database, options.scope);
  const days = Math.max(1, parseInt(options.days ?? '90', 10) || 90);

  const entries = getScoreHistory(database, catalog.id, scopeId, days);

  if (options.json) {
    console.log(JSON.stringify({ catalog: catalog.short_name, scope_id: scopeId, since_days: days, entries }, null, 2));
    return;
  }

  if (entries.length === 0) {
    warn(`No score history for ${catalog.short_name} (${scopeId ?? 'org-wide'}) in the last ${days} days.`);
    return;
  }

  info(`Score history — ${catalog.short_name} / ${scopeId ?? 'org-wide'} (${entries.length} points over ${days} days)`);
  log('');
  for (const e of entries) {
    log(
      `  ${e.calculated_at}  overall=${fmtScore(e.overall_score).padStart(8)}` +
      `  cov=${fmtScore(e.coverage_score).padStart(8)}` +
      `  ev=${fmtScore(e.evidence_score).padStart(8)}` +
      `  as=${fmtScore(e.assessment_score).padStart(8)}` +
      `  [${e.trigger}]`,
    );
  }

  const first = entries[0].overall_score;
  const last = entries[entries.length - 1].overall_score;
  const delta = last - first;
  log('');
  log(`  Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} points`);
}
