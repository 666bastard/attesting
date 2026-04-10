import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { info, success, error, warn, log } from '../../utils/logger.js';
import { diffCatalogs, type DiffResult, type ControlChange } from '../../mappers/diff.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting catalog diff` subcommand.
 */
export function registerCatalogDiff(catalogCommand: Command): void {
  catalogCommand
    .command('diff')
    .description('Compare two catalog versions and produce a change report')
    .requiredOption('--old <shortName>', 'Old catalog version short name')
    .requiredOption('--new <shortName>', 'New catalog version short name')
    .option('--output <file>', 'Output file path (.json or .csv)')
    .option('--scope <name>', 'Scope name for implementation impact analysis')
    .action(runCatalogDiff);
}

interface CatalogDiffOptions {
  old: string;
  new: string;
  output?: string;
  scope?: string;
}

function runCatalogDiff(options: CatalogDiffOptions): void {
  const database = db.getDb();

  // Validate catalogs exist
  for (const shortName of [options.old, options.new]) {
    const cat = database
      .prepare('SELECT id FROM catalogs WHERE short_name = ?')
      .get(shortName);
    if (!cat) {
      error(`Catalog "${shortName}" not found.`);
      process.exit(1);
    }
  }

  // Get org for implementation impact
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  let scopeId: string | null = null;
  if (options.scope) {
    const scopeRow = database
      .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string } | undefined;
    if (!scopeRow) {
      warn(`Scope not found: "${options.scope}"`);
    } else {
      scopeId = scopeRow.id;
    }
  }

  info(`Comparing: ${options.old} → ${options.new}`);

  const result = diffCatalogs(
    options.old,
    options.new,
    database,
    org?.id,
    scopeId ?? undefined
  );

  // Handle output
  if (options.output) {
    const ext = path.extname(options.output).toLowerCase();
    if (ext === '.json') {
      writeJsonReport(result, options.output);
    } else if (ext === '.csv') {
      writeCsvReport(result, options.output);
    } else {
      error(`Unsupported output format "${ext}". Use .json or .csv`);
      process.exit(1);
    }
  }

  // Terminal output
  printDiffSummary(result);
  printDiffDetails(result);
}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function rpad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return ' '.repeat(width - s.length) + s;
}

function printDiffSummary(result: DiffResult): void {
  log('');
  log(`Diff: ${result.oldCatalogShortName} → ${result.newCatalogShortName}`);
  log('─'.repeat(60));
  log(`  Added:       ${rpad(String(result.summary.added), 6)}  (new controls)`);
  log(`  Removed:     ${rpad(String(result.summary.removed), 6)}  (dropped controls)`);
  log(`  Modified:    ${rpad(String(result.summary.modified), 6)}  (content changed)`);
  log(`  Renumbered:  ${rpad(String(result.summary.renumbered), 6)}  (ID changed, content same)`);
  log(`  Unchanged:   ${rpad(String(result.summary.unchanged), 6)}`);
  log('─'.repeat(60));
  log(`  Total:       ${rpad(String(result.summary.total), 6)}`);
  log('');
}

function printDiffDetails(result: DiffResult): void {
  const COL_ID = 20;
  const COL_TITLE = 40;
  const COL_ACTION = 28;

  if (result.added.length > 0) {
    log(`ADDED (${result.added.length}):`);
    for (const c of result.added) {
      const ctrl = c.newControl!;
      log(
        `  + ${pad(ctrl.control_id, COL_ID)} ${pad(truncate(ctrl.title, COL_TITLE), COL_TITLE)} ${c.actionNeeded}`
      );
    }
    log('');
  }

  if (result.removed.length > 0) {
    log(`REMOVED (${result.removed.length}):`);
    for (const c of result.removed) {
      const ctrl = c.oldControl!;
      const implNote = c.hasExistingImpl ? ' [has implementation]' : '';
      log(
        `  - ${pad(ctrl.control_id, COL_ID)} ${pad(truncate(ctrl.title, COL_TITLE), COL_TITLE)}${implNote}`
      );
    }
    log('');
  }

  if (result.modified.length > 0) {
    log(`MODIFIED (${result.modified.length}):`);
    for (const c of result.modified) {
      const ctrl = c.newControl!;
      const sevTag = c.severity ? `[${c.severity}]` : '';
      log(
        `  ~ ${pad(ctrl.control_id, COL_ID)} ${pad(truncate(ctrl.title, COL_TITLE), COL_TITLE)} ${sevTag} ${c.actionNeeded}`
      );
      if (c.descriptionDiff && c.severity !== 'minor') {
        if (c.descriptionDiff.removed.length > 0) {
          log(`      removed words: ${c.descriptionDiff.removed.slice(0, 10).join(', ')}`);
        }
        if (c.descriptionDiff.added.length > 0) {
          log(`      added words:   ${c.descriptionDiff.added.slice(0, 10).join(', ')}`);
        }
      }
      if (c.affectedMappings.length > 0) {
        log(`      mapped: ${c.affectedMappings.slice(0, 5).join(', ')}`);
      }
    }
    log('');
  }

  if (result.renumbered.length > 0) {
    log(`RENUMBERED (${result.renumbered.length}):`);
    for (const c of result.renumbered) {
      const implNote = c.hasExistingImpl ? ' [has implementation]' : '';
      log(
        `  ↔ ${pad(c.renumberedFrom ?? '?', COL_ID)} → ${pad(c.newControl!.control_id, COL_ID)} ${pad(truncate(c.newControl!.title, COL_TITLE), COL_TITLE)}${implNote}`
      );
    }
    log('');
  }

  // Impact summary
  const withImpl = [
    ...result.modified.filter((c) => c.hasExistingImpl),
    ...result.renumbered.filter((c) => c.hasExistingImpl),
    ...result.removed.filter((c) => c.hasExistingImpl),
  ];
  if (withImpl.length > 0 || result.added.length > 0) {
    log('IMPACT SUMMARY:');
    if (result.added.length > 0) {
      log(`  ${result.added.length} new controls require implementation`);
    }
    const reviewCount = result.modified.filter((c) => c.hasExistingImpl).length;
    if (reviewCount > 0) {
      log(`  ${reviewCount} modified controls need implementation review`);
    }
    const renumCount = result.renumbered.filter((c) => c.hasExistingImpl).length;
    if (renumCount > 0) {
      log(`  ${renumCount} renumbered controls — implementations can be auto-migrated`);
    }
    const orphanCount = result.removed.filter((c) => c.hasExistingImpl).length;
    if (orphanCount > 0) {
      log(`  ${orphanCount} removed controls have orphaned implementations`);
    }
    log('');
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

function writeJsonReport(result: DiffResult, outputPath: string): void {
  const report = {
    generated: new Date().toISOString(),
    oldCatalog: result.oldCatalogShortName,
    newCatalog: result.newCatalogShortName,
    summary: result.summary,
    changes: [
      ...result.added.map(formatChangeForJson),
      ...result.removed.map(formatChangeForJson),
      ...result.modified.map(formatChangeForJson),
      ...result.renumbered.map(formatChangeForJson),
    ],
  };

  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, JSON.stringify(report, null, 2));
  success(`JSON report written to ${resolved}`);
}

function formatChangeForJson(c: ControlChange): Record<string, unknown> {
  return {
    changeType: c.changeType,
    controlId: c.newControl?.control_id ?? c.oldControl?.control_id,
    oldControlId: c.oldControl?.control_id ?? null,
    title: c.newControl?.title ?? c.oldControl?.title,
    severity: c.severity ?? null,
    renumberedFrom: c.renumberedFrom ?? null,
    hasExistingImpl: c.hasExistingImpl,
    actionNeeded: c.actionNeeded,
    affectedMappings: c.affectedMappings,
    descriptionSimilarity: c.descriptionDiff?.similarity ?? null,
  };
}

function writeCsvReport(result: DiffResult, outputPath: string): void {
  const lines: string[] = [
    'change_type,control_id,old_control_id,title,severity,action_needed,has_impl,affected_mappings',
  ];

  const allChanges = [
    ...result.added,
    ...result.removed,
    ...result.modified,
    ...result.renumbered,
  ];

  for (const c of allChanges) {
    const controlId = c.newControl?.control_id ?? c.oldControl?.control_id ?? '';
    const oldId = c.oldControl?.control_id ?? '';
    const title = csvEscape(c.newControl?.title ?? c.oldControl?.title ?? '');
    const mappings = c.affectedMappings.join('|');
    lines.push(
      `${c.changeType},${controlId},${oldId},${title},${c.severity ?? ''},${c.actionNeeded},${c.hasExistingImpl},${csvEscape(mappings)}`
    );
  }

  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, lines.join('\n'));
  success(`CSV report written to ${resolved}`);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
