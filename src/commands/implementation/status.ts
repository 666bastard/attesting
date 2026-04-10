import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { log, warn } from '../../utils/logger.js';
import { calculateCoverage } from '../../mappers/coverage.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting impl status` subcommand.
 */
export function registerImplStatus(implCommand: Command): void {
  implCommand
    .command('status')
    .description('Show implementation coverage statistics per catalog')
    .option('--scope <name>', 'Scope name (omit for org-wide)')
    .option('--json', 'Output as JSON')
    .action(runImplStatus);
}

interface ImplStatusOptions {
  scope?: string;
  json?: boolean;
}

function runImplStatus(options: ImplStatusOptions): void {
  const database = db.getDb();

  // Require at least one organization
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    warn('No organization found. Run `attesting org init --name <name>` first.');
    return;
  }

  // Resolve scope ID if provided
  let scopeId: string | null = null;
  if (options.scope) {
    const scopeRow = database
      .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string } | undefined;

    if (!scopeRow) {
      warn(`Scope not found: "${options.scope}"`);
      return;
    }
    scopeId = scopeRow.id;
  }

  const results = calculateCoverage(org.id, scopeId, database);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    warn('No catalogs with controls found.');
    return;
  }

  function pad(s: string, width: number): string {
    if (s.length >= width) return s.slice(0, width);
    return s + ' '.repeat(width - s.length);
  }

  function rpad(s: string, width: number): string {
    if (s.length >= width) return s.slice(0, width);
    return ' '.repeat(width - s.length) + s;
  }

  const COL_NAME = 30;
  const COL_NUM = 10;
  const COL_PCT = 12;

  const header =
    pad('Catalog', COL_NAME) +
    rpad('Controls', COL_NUM) +
    rpad('Impl', COL_NUM) +
    rpad('Mapped', COL_NUM) +
    rpad('Partial', COL_NUM) +
    rpad('N/A', COL_NUM) +
    rpad('Not Impl.', COL_NUM) +
    rpad('Coverage', COL_PCT);

  log('');
  log(header);
  log('-'.repeat(header.length));

  for (const r of results) {
    // Coverage column: "X%" for direct only, "X% (Y% eff.)" when mapped coverage exists
    const coverageStr = r.mappedCoverage > 0
      ? `${r.coveragePct}% (${r.effectivePct}%)`
      : `${r.coveragePct}%`;

    log(
      pad(r.catalogName, COL_NAME) +
        rpad(String(r.totalControls), COL_NUM) +
        rpad(String(r.implemented), COL_NUM) +
        rpad(String(r.mappedCoverage), COL_NUM) +
        rpad(String(r.partial), COL_NUM) +
        rpad(String(r.notApplicable), COL_NUM) +
        rpad(String(r.notImplemented), COL_NUM) +
        rpad(coverageStr, COL_PCT)
    );
  }

  log('');
  log('Coverage = (Impl + N/A) / Controls. Mapped = covered via control_mappings.');
  if (results.some((r) => r.mappedCoverage > 0)) {
    log('Effective % includes mapped controls: (Impl + N/A + Mapped) / Controls.');
  }
  log('');
}
