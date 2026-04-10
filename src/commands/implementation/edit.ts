import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { now } from '../../utils/dates.js';
import { success, error, warn } from '../../utils/logger.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting impl edit` subcommand.
 */
export function registerImplEdit(implCommand: Command): void {
  implCommand
    .command('edit <ref>')
    .description('Edit an existing implementation statement (format: catalog:control_id)')
    .option('--scope <name>', 'Scope name to narrow the lookup')
    .option('--status <status>', 'New implementation status')
    .option('--statement <text>', 'New implementation narrative')
    .option('--response <response>', 'New SIG response (Yes|No|N/A)')
    .action(runImplEdit);
}

interface ImplEditOptions {
  scope?: string;
  status?: string;
  statement?: string;
  response?: string;
}

function runImplEdit(ref: string, options: ImplEditOptions): void {
  const database = db.getDb();

  // Require organization
  const org = database
    .prepare('SELECT id FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id'> | undefined;

  if (!org) {
    error('No organization found. Run `attesting org init --name <name>` first.');
    process.exit(1);
  }

  // Parse catalog:control_id
  const colonIdx = ref.indexOf(':');
  if (colonIdx === -1) {
    error(`Invalid reference "${ref}". Expected format: catalog:control_id`);
    process.exit(1);
  }
  const catalogShortName = ref.slice(0, colonIdx).trim();
  const controlNativeId = ref.slice(colonIdx + 1).trim();

  // Look up control UUID
  const controlRow = database
    .prepare(
      `SELECT c.id
         FROM controls c
         JOIN catalogs cat ON c.catalog_id = cat.id
        WHERE cat.short_name = ? AND c.control_id = ?
        LIMIT 1`
    )
    .get(catalogShortName, controlNativeId) as { id: string } | undefined;

  if (!controlRow) {
    error(`Control not found: ${ref}`);
    process.exit(1);
  }

  // Build lookup for implementation
  let implId: string | null = null;

  if (options.scope) {
    const scopeRow = database
      .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string } | undefined;

    if (!scopeRow) {
      error(`Scope not found: "${options.scope}"`);
      process.exit(1);
    }

    const impl = database
      .prepare(
        `SELECT id FROM implementations
          WHERE org_id = ? AND primary_control_id = ? AND scope_id = ?
          LIMIT 1`
      )
      .get(org.id, controlRow.id, scopeRow.id) as { id: string } | undefined;
    implId = impl?.id ?? null;
  } else {
    const impl = database
      .prepare(
        `SELECT id FROM implementations
          WHERE org_id = ? AND primary_control_id = ?
          LIMIT 1`
      )
      .get(org.id, controlRow.id) as { id: string } | undefined;
    implId = impl?.id ?? null;
  }

  if (!implId) {
    warn(`No implementation found for ${ref}${options.scope ? ` in scope "${options.scope}"` : ''}.`);
    return;
  }

  // Build update SET clause from provided fields
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (options.status !== undefined) {
    setClauses.push('status = ?');
    params.push(options.status);
  }
  if (options.statement !== undefined) {
    setClauses.push('statement = ?');
    params.push(options.statement);
  }
  if (options.response !== undefined) {
    setClauses.push('sig_response = ?');
    params.push(options.response);
  }

  if (setClauses.length === 0) {
    warn('No fields provided to update. Use --status, --statement, or --response.');
    return;
  }

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(implId);

  database
    .prepare(
      `UPDATE implementations SET ${setClauses.join(', ')} WHERE id = ?`
    )
    .run(...params);

  success(`Implementation updated for ${ref}`);
}
