import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, info, log } from '../../utils/logger.js';
import { snapshotScore } from '../../services/scoring/snapshot.js';
import { resolveCatalog, resolveScope, fmtScore } from './_common.js';

interface SnapshotOptions {
  catalog: string;
  scope?: string;
  json?: boolean;
}

export function registerScoreSnapshot(scoreCommand: Command): void {
  scoreCommand
    .command('snapshot')
    .description('Take a manual score snapshot (updates compliance_scores + history)')
    .requiredOption('--catalog <ref>', 'Catalog short_name or UUID')
    .option('--scope <ref>', 'Scope name, UUID, or "org" (default: org-wide)')
    .option('--json', 'Output as JSON')
    .action(runSnapshot);
}

function runSnapshot(options: SnapshotOptions): void {
  const database = db.getDb();
  const catalog = resolveCatalog(database, options.catalog);
  const scopeId = resolveScope(database, options.scope);

  const snap = snapshotScore(database, catalog.id, scopeId, { trigger: 'manual' });

  if (options.json) {
    console.log(JSON.stringify(snap, null, 2));
    return;
  }

  success(`Snapshot taken for ${catalog.short_name} (${scopeId ?? 'org-wide'})`);
  info(`  Overall:    ${fmtScore(snap.overall_score)}`);
  log(`  Coverage:   ${fmtScore(snap.coverage_score)}`);
  log(`  Evidence:   ${fmtScore(snap.evidence_score)}`);
  log(`  Assessment: ${fmtScore(snap.assessment_score)}`);
  log(`  Calculated: ${snap.calculated_at}`);
}
