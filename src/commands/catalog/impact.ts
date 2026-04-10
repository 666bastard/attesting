import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, success, error, warn, log } from '../../utils/logger.js';
import { diffCatalogs } from '../../mappers/diff.js';
import { calculateCoverage } from '../../mappers/coverage.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting catalog impact` subcommand.
 */
export function registerCatalogImpact(catalogCommand: Command): void {
  catalogCommand
    .command('impact')
    .description('Analyze the impact of upgrading from one catalog version to another')
    .requiredOption('--old <shortName>', 'Old catalog version short name')
    .requiredOption('--new <shortName>', 'New catalog version short name')
    .option('--scope <name>', 'Scope name for implementation impact')
    .action(runCatalogImpact);
}

interface CatalogImpactOptions {
  old: string;
  new: string;
  scope?: string;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function rpad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return ' '.repeat(width - s.length) + s;
}

function runCatalogImpact(options: CatalogImpactOptions): void {
  const database = db.getDb();

  // Validate catalogs
  for (const shortName of [options.old, options.new]) {
    const cat = database.prepare('SELECT id FROM catalogs WHERE short_name = ?').get(shortName);
    if (!cat) {
      error(`Catalog "${shortName}" not found.`);
      process.exit(1);
    }
  }

  // Get org
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    error('No organization found. Run `attesting org init --name <name>` first.');
    process.exit(1);
  }

  // Resolve scope
  let scopeId: string | null = null;
  let scopeLabel = 'org-wide';
  if (options.scope) {
    const scopeRow = database
      .prepare('SELECT id, name FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string; name: string } | undefined;
    if (!scopeRow) {
      warn(`Scope "${options.scope}" not found. Showing org-wide impact.`);
    } else {
      scopeId = scopeRow.id;
      scopeLabel = scopeRow.name;
    }
  }

  info(`Impact analysis: ${options.old} → ${options.new}`);
  if (scopeId) info(`Scope: ${scopeLabel}`);

  // Run diff
  const diff = diffCatalogs(options.old, options.new, database, org.id, scopeId ?? undefined);

  // Get coverage for both catalogs
  const allCoverage = calculateCoverage(org.id, scopeId, database);
  const oldCov = allCoverage.find((c) => c.catalogShortName === options.old);
  const newCov = allCoverage.find((c) => c.catalogShortName === options.new);

  // ─── Section 1: Migration Summary ───
  log('');
  log('═══════════════════════════════════════════════════════════');
  log('  IMPLEMENTATION MIGRATION SUMMARY');
  log('═══════════════════════════════════════════════════════════');
  log('');

  const autoMigrate = diff.unchanged.filter((c) => c.hasExistingImpl).length +
    diff.renumbered.filter((c) => c.hasExistingImpl).length;
  const needsReview = diff.modified.filter((c) => c.hasExistingImpl).length;
  const newGaps = diff.summary.added;
  const orphaned = diff.removed.filter((c) => c.hasExistingImpl).length;

  log(`  Auto-migrated (no changes needed):  ${autoMigrate}`);
  log(`  Needs review (content changed):     ${needsReview}`);
  log(`  New gaps (new controls):            ${newGaps}`);
  log(`  Orphaned (removed controls):        ${orphaned}`);
  log('');

  // ─── Section 2: Coverage Comparison ───
  log('═══════════════════════════════════════════════════════════');
  log('  COVERAGE COMPARISON');
  log('═══════════════════════════════════════════════════════════');
  log('');

  const COL = 30;
  // Dynamic column width based on short name lengths
  const COL_N = Math.max(12, options.old.length + 2, options.new.length + 2);

  log(
    pad('', COL) +
    rpad(options.old, COL_N) +
    rpad(options.new, COL_N) +
    rpad('Delta', COL_N)
  );
  log('─'.repeat(COL + COL_N * 3));

  if (oldCov && newCov) {
    const rows: Array<{ label: string; oldVal: number; newVal: number }> = [
      { label: 'Total controls', oldVal: oldCov.totalControls, newVal: newCov.totalControls },
      { label: 'Implemented', oldVal: oldCov.implemented, newVal: newCov.implemented },
      { label: 'Partially implemented', oldVal: oldCov.partial, newVal: newCov.partial },
      { label: 'Not applicable', oldVal: oldCov.notApplicable, newVal: newCov.notApplicable },
      { label: 'Not implemented', oldVal: oldCov.notImplemented, newVal: newCov.notImplemented },
      { label: 'Mapped coverage', oldVal: oldCov.mappedCoverage, newVal: newCov.mappedCoverage },
    ];

    for (const row of rows) {
      const delta = row.newVal - row.oldVal;
      const deltaStr = delta > 0 ? `+${delta}` : delta === 0 ? '—' : String(delta);
      log(
        pad(row.label, COL) +
        rpad(String(row.oldVal), COL_N) +
        rpad(String(row.newVal), COL_N) +
        rpad(deltaStr, COL_N)
      );
    }

    log('─'.repeat(COL + COL_N * 3));

    const oldPct = oldCov.coveragePct;
    const newPct = newCov.coveragePct;
    const pctDelta = Math.round((newPct - oldPct) * 10) / 10;
    const pctStr = pctDelta > 0 ? `+${pctDelta}%` : pctDelta === 0 ? '—' : `${pctDelta}%`;
    log(
      pad('Coverage %', COL) +
      rpad(`${oldPct}%`, COL_N) +
      rpad(`${newPct}%`, COL_N) +
      rpad(pctStr, COL_N)
    );

    const oldEff = oldCov.effectivePct;
    const newEff = newCov.effectivePct;
    const effDelta = Math.round((newEff - oldEff) * 10) / 10;
    const effStr = effDelta > 0 ? `+${effDelta}%` : effDelta === 0 ? '—' : `${effDelta}%`;
    log(
      pad('Effective % (w/ mapped)', COL) +
      rpad(`${oldEff}%`, COL_N) +
      rpad(`${newEff}%`, COL_N) +
      rpad(effStr, COL_N)
    );
  } else {
    if (!oldCov) warn(`  No coverage data for ${options.old} (no implementations?)`);
    if (!newCov) warn(`  No coverage data for ${options.new} (run catalog update first)`);
  }

  log('');

  // ─── Section 3: Priority Action Items ───
  log('═══════════════════════════════════════════════════════════');
  log('  PRIORITY ACTION ITEMS');
  log('═══════════════════════════════════════════════════════════');
  log('');

  // Sort by risk: major modifications first, then moderate, then new controls
  const actions: Array<{ priority: number; label: string; detail: string }> = [];

  // Major modifications with existing implementations = highest risk
  for (const c of diff.modified) {
    if (!c.hasExistingImpl) continue;
    const prio = c.severity === 'major' ? 1 : c.severity === 'moderate' ? 2 : 3;
    actions.push({
      priority: prio,
      label: `REVIEW [${c.severity}]`,
      detail: `${c.newControl!.control_id}: ${truncate(c.newControl!.title, 60)}`,
    });
  }

  // New controls = medium risk
  for (const c of diff.added) {
    actions.push({
      priority: 2,
      label: 'NEW GAP',
      detail: `${c.newControl!.control_id}: ${truncate(c.newControl!.title, 60)}`,
    });
  }

  // Orphaned implementations = low risk
  for (const c of diff.removed) {
    if (!c.hasExistingImpl) continue;
    actions.push({
      priority: 4,
      label: 'ORPHANED',
      detail: `${c.oldControl!.control_id}: ${truncate(c.oldControl!.title, 60)}`,
    });
  }

  actions.sort((a, b) => a.priority - b.priority);

  if (actions.length === 0) {
    success('  No action items — all implementations are up to date.');
  } else {
    const COL_P = 22;
    const shown = actions.slice(0, 30);
    for (const a of shown) {
      log(`  ${pad(a.label, COL_P)} ${a.detail}`);
    }
    if (actions.length > 30) {
      log(`  … and ${actions.length - 30} more`);
    }
  }

  log('');
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
