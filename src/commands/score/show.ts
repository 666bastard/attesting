import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, log } from '../../utils/logger.js';
import { calculateScore } from '../../services/scoring/compliance-score.js';
import { getLatestScore } from '../../services/scoring/snapshot.js';
import { resolveCatalog, resolveScope, fmtScore } from './_common.js';

interface ShowOptions {
  catalog: string;
  scope?: string;
  fresh?: boolean;
  json?: boolean;
}

export function registerScoreShow(scoreCommand: Command): void {
  scoreCommand
    .command('show')
    .description('Show the compliance score for a catalog + scope')
    .requiredOption('--catalog <ref>', 'Catalog short_name or UUID')
    .option('--scope <ref>', 'Scope name, UUID, or "org" (default: org-wide)')
    .option('--fresh', 'Recompute on the fly instead of reading the latest snapshot')
    .option('--json', 'Output as JSON')
    .action(runShow);
}

function runShow(options: ShowOptions): void {
  const database = db.getDb();
  const catalog = resolveCatalog(database, options.catalog);
  const scopeId = resolveScope(database, options.scope);

  const snapshot = options.fresh
    ? { persisted: false, calculated_at: new Date().toISOString(), ...calculateScore(database, catalog.id, scopeId) }
    : getLatestScore(database, catalog.id, scopeId);

  if (!snapshot) {
    const computed = { persisted: false, calculated_at: new Date().toISOString(), ...calculateScore(database, catalog.id, scopeId) };
    output(options, catalog, scopeId, computed);
    return;
  }
  output(options, catalog, scopeId, snapshot);
}

function output(
  options: ShowOptions,
  catalog: { short_name: string; name: string },
  scopeId: string | null,
  score: any,
): void {
  if (options.json) {
    console.log(JSON.stringify(score, null, 2));
    return;
  }

  info(`Compliance score — ${catalog.name} (${catalog.short_name})`);
  log(`  Scope:        ${scopeId ?? 'org-wide'}`);
  log(`  Overall:      ${fmtScore(score.overall_score)}`);
  log(`  Coverage:     ${fmtScore(score.coverage_score)}  (weight ${Math.round((score.coverage_weight ?? 0) * 100)}%)`);
  log(`  Evidence:     ${fmtScore(score.evidence_score)}  (weight ${Math.round((score.evidence_weight ?? 0) * 100)}%)`);
  log(`  Assessment:   ${fmtScore(score.assessment_score)}  (weight ${Math.round((score.assessment_weight ?? 0) * 100)}%)`);
  log('');
  log(`  Controls:     ${score.total_controls} total, ${score.implemented_count} implemented, ${score.partial_count} partial, ${score.not_applicable_count} N/A`);
  log(`  Evidence:     ${score.total_evidence_count} total, ${score.fresh_evidence_count} fresh, ${score.stale_evidence_count} stale`);
  log(`  Assessments:  ${score.total_assessment_count} results, ${score.satisfied_assessment_count} satisfied, ${score.partial_assessment_count} partial`);

  if (score.family_breakdown && score.family_breakdown.length > 0) {
    log('');
    log('  Per-family:');
    for (const f of score.family_breakdown) {
      log(`    ${f.family.padEnd(24)} ${fmtScore(f.score).padStart(8)}   (${f.implemented}/${f.total - f.not_applicable} implemented)`);
    }
  }

  log('');
  log(`  ${score.persisted === false ? 'computed on the fly' : `snapshot taken ${score.calculated_at}`}`);
}
