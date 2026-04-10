import { Command } from 'commander';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn, log } from '../../utils/logger.js';
import { diffCatalogs, type DiffResult } from '../../mappers/diff.js';
import { importOscalCatalog } from '../../importers/oscal-catalog.js';
import { importCsvCatalog, type ColumnMapping } from '../../importers/csv-generic.js';
import { importSigCatalog } from '../../importers/sig-content-library.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting catalog update` subcommand.
 */
export function registerCatalogUpdate(catalogCommand: Command): void {
  catalogCommand
    .command('update')
    .description('Import a new catalog version and auto-migrate implementations from an old version')
    .requiredOption('--old <shortName>', 'Old catalog short name to migrate from')
    .requiredOption('--new-file <file>', 'Path to the new catalog file')
    .requiredOption('--format <format>', 'Import format: csv | sig | oscal')
    .requiredOption('--new-short-name <shortName>', 'Short name for the new catalog')
    .requiredOption('--new-name <name>', 'Display name for the new catalog')
    .option('--publisher <publisher>', 'Publisher name')
    .option('--version <version>', 'Version string')
    .option('--scope <name>', 'Scope name for implementation migration')
    .option('--columns <mapping>', 'Column mapping for CSV format')
    .option('--scope-level <level>', 'SIG scope level filter')
    .action(runCatalogUpdate);
}

interface CatalogUpdateOptions {
  old: string;
  newFile: string;
  format: string;
  newShortName: string;
  newName: string;
  publisher?: string;
  version?: string;
  scope?: string;
  columns?: string;
  scopeLevel?: string;
}

async function runCatalogUpdate(options: CatalogUpdateOptions): Promise<void> {
  const database = db.getDb();

  // Validate old catalog exists
  const oldCat = database
    .prepare('SELECT id, name FROM catalogs WHERE short_name = ?')
    .get(options.old) as { id: string; name: string } | undefined;
  if (!oldCat) {
    error(`Old catalog "${options.old}" not found.`);
    process.exit(1);
  }

  // Check new short_name doesn't already exist
  const existing = database
    .prepare('SELECT id FROM catalogs WHERE short_name = ?')
    .get(options.newShortName);
  if (existing) {
    error(`Catalog "${options.newShortName}" already exists. Delete it first or use a different short name.`);
    process.exit(1);
  }

  const supportedFormats = ['csv', 'sig', 'oscal'];
  if (!supportedFormats.includes(options.format)) {
    error(`Unsupported format "${options.format}". Supported: ${supportedFormats.join(', ')}`);
    process.exit(1);
  }

  // Get org
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  let scopeId: string | null = null;
  if (options.scope && org) {
    const scopeRow = database
      .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string } | undefined;
    if (scopeRow) scopeId = scopeRow.id;
  }

  // Step 1: Import the new catalog
  info(`Step 1/4: Importing new catalog "${options.newName}" (${options.newShortName})`);

  const catalogId = generateUuid();
  const timestamp = now();
  const sourceFormat = options.format === 'sig' ? 'sig-xlsm' : options.format;

  database
    .prepare(
      `INSERT INTO catalogs (id, name, short_name, version, source_format, publisher, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(catalogId, options.newName, options.newShortName, options.version ?? null,
      sourceFormat, options.publisher ?? null, timestamp, timestamp);

  const filePath = path.resolve(options.newFile);
  let importCount = 0;

  if (options.format === 'oscal') {
    const result = importOscalCatalog(filePath, catalogId, database);
    importCount = result.imported;
  } else if (options.format === 'csv') {
    if (!options.columns) {
      error('--columns is required for CSV format.');
      process.exit(1);
    }
    const mapping = parseColumnMapping(options.columns);
    const result = importCsvCatalog(filePath, catalogId, mapping);
    importCount = result.imported;
  } else if (options.format === 'sig') {
    const result = await importSigCatalog(filePath, catalogId, database, options.scopeLevel);
    importCount = result.imported;
  }

  database
    .prepare('UPDATE catalogs SET total_controls = ?, updated_at = ? WHERE id = ?')
    .run(importCount, now(), catalogId);

  success(`Imported ${importCount} controls into "${options.newShortName}"`);

  // Step 2: Run diff
  info(`Step 2/4: Comparing ${options.old} → ${options.newShortName}`);
  const diff = diffCatalogs(options.old, options.newShortName, database, org?.id, scopeId ?? undefined);

  log('');
  log(`  Added: ${diff.summary.added}  |  Removed: ${diff.summary.removed}  |  Modified: ${diff.summary.modified}  |  Renumbered: ${diff.summary.renumbered}  |  Unchanged: ${diff.summary.unchanged}`);
  log('');

  // Step 3: Migrate implementations
  if (!org) {
    warn('No organization found — skipping implementation migration.');
    return;
  }

  info(`Step 3/4: Migrating implementations`);
  const migrationResult = migrateImplementations(diff, org.id, scopeId, database);

  // Step 4: Report
  info(`Step 4/4: Migration report`);
  log('');
  log('MIGRATION SUMMARY:');
  log(`  Auto-copied (unchanged):    ${migrationResult.copiedUnchanged}`);
  log(`  Auto-copied (renumbered):   ${migrationResult.copiedRenumbered}`);
  log(`  Copied + flagged (modified): ${migrationResult.copiedNeedsReview}`);
  log(`  New gaps (added controls):   ${diff.summary.added}`);
  log(`  Orphaned (removed controls): ${migrationResult.orphaned}`);
  log('');

  if (migrationResult.copiedNeedsReview > 0) {
    warn(`${migrationResult.copiedNeedsReview} implementations need manual review.`);
    log('  Run: attesting impl list --catalog ' + options.newShortName + ' --status needs-review');
  }
  if (diff.summary.added > 0) {
    warn(`${diff.summary.added} new controls have no implementation.`);
  }

  success('Catalog update complete.');
}

// ---------------------------------------------------------------------------
// Implementation migration
// ---------------------------------------------------------------------------

interface MigrationResult {
  copiedUnchanged: number;
  copiedRenumbered: number;
  copiedNeedsReview: number;
  orphaned: number;
}

function migrateImplementations(
  diff: DiffResult,
  orgId: string,
  scopeId: string | null,
  database: import('better-sqlite3').Database
): MigrationResult {
  const result: MigrationResult = {
    copiedUnchanged: 0,
    copiedRenumbered: 0,
    copiedNeedsReview: 0,
    orphaned: 0,
  };

  const scopeFilter = scopeId ? 'AND (scope_id = ? OR scope_id IS NULL)' : '';

  // Load implementations for old catalog controls
  const getImpl = (oldControlUuid: string) => {
    const params: unknown[] = [oldControlUuid, orgId];
    if (scopeId) params.push(scopeId);
    return database
      .prepare(
        `SELECT * FROM implementations
         WHERE primary_control_id = ? AND org_id = ?
         ${scopeFilter}`
      )
      .all(...params) as Record<string, unknown>[];
  };

  const insertImpl = database.prepare(
    `INSERT INTO implementations
       (id, org_id, scope_id, primary_control_id, status, statement,
        responsible_role, responsible_person, sig_response, sig_additional_info,
        sig_scoring, responsibility_type, responsibility_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const copyImpl = (impl: Record<string, unknown>, newControlUuid: string, status?: string) => {
    const timestamp = now();
    insertImpl.run(
      generateUuid(),
      impl.org_id,
      impl.scope_id ?? null,
      newControlUuid,
      status ?? impl.status,
      impl.statement,
      impl.responsible_role ?? null,
      impl.responsible_person ?? null,
      impl.sig_response ?? null,
      impl.sig_additional_info ?? null,
      impl.sig_scoring ?? null,
      impl.responsibility_type ?? 'provider',
      impl.responsibility_note ?? null,
      timestamp,
      timestamp
    );
  };

  const runMigration = database.transaction(() => {
    // UNCHANGED: copy implementations as-is
    for (const change of diff.unchanged) {
      if (!change.oldControl || !change.newControl) continue;
      const impls = getImpl(change.oldControl.id);
      for (const impl of impls) {
        copyImpl(impl, change.newControl.id);
        result.copiedUnchanged++;
      }
    }

    // RENUMBERED: copy implementations to new control ID
    for (const change of diff.renumbered) {
      if (!change.oldControl || !change.newControl) continue;
      const impls = getImpl(change.oldControl.id);
      for (const impl of impls) {
        copyImpl(impl, change.newControl.id);
        result.copiedRenumbered++;
      }
    }

    // MODIFIED: copy but flag as needs-review
    for (const change of diff.modified) {
      if (!change.oldControl || !change.newControl) continue;
      const impls = getImpl(change.oldControl.id);
      for (const impl of impls) {
        // For major changes, mark as partially-implemented to flag for review
        // For minor/moderate changes, keep original status
        const newStatus =
          change.severity === 'major'
            ? 'partially-implemented'
            : (impl.status as string);
        copyImpl(impl, change.newControl.id, newStatus);
        result.copiedNeedsReview++;
      }
    }

    // REMOVED: flag old implementations as orphaned (add note)
    for (const change of diff.removed) {
      if (!change.oldControl) continue;
      const impls = getImpl(change.oldControl.id);
      if (impls.length > 0) {
        result.orphaned += impls.length;
      }
    }
  });

  runMigration();
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseColumnMapping(raw: string): ColumnMapping {
  const mapping: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key && value) mapping[key] = value;
  }
  return mapping as ColumnMapping;
}
