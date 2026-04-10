import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error } from '../../utils/logger.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting impl add` subcommand.
 */
export function registerImplAdd(implCommand: Command): void {
  implCommand
    .command('add')
    .description('Add an implementation statement for a control')
    .requiredOption('--control <ref>', 'Control reference: catalog:control_id')
    .requiredOption('--statement <text>', 'Implementation narrative')
    .option('--scope <name>', 'Scope name')
    .option('--status <status>', 'Implementation status', 'implemented')
    .option('--response <response>', 'SIG response (Yes|No|N/A)')
    .option('--responsible-role <role>', 'Responsible role or team')
    .option('--responsibility <type>', 'Responsibility type (provider|customer|shared|inherited)', 'provider')
    .action(runImplAdd);
}

interface ImplAddOptions {
  control: string;
  statement: string;
  scope?: string;
  status: string;
  response?: string;
  responsibleRole?: string;
  responsibility: string;
}

function runImplAdd(options: ImplAddOptions): void {
  const database = db.getDb();

  // Require at least one organization
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    error('No organization found. Run `attesting org init --name <name>` first.');
    process.exit(1);
  }

  // Parse catalog:control_id
  const colonIdx = options.control.indexOf(':');
  if (colonIdx === -1) {
    error(`Invalid control reference "${options.control}". Expected format: catalog:control_id`);
    process.exit(1);
  }
  const catalogShortName = options.control.slice(0, colonIdx).trim();
  const controlNativeId = options.control.slice(colonIdx + 1).trim();

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
    error(`Control not found: ${options.control}`);
    process.exit(1);
  }

  // Look up scope UUID if provided
  let scopeId: string | null = null;
  if (options.scope) {
    const scopeRow = database
      .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string } | undefined;

    if (!scopeRow) {
      error(`Scope not found: "${options.scope}". Use \`attesting scope create\` to create it.`);
      process.exit(1);
    }
    scopeId = scopeRow.id;
  }

  const id = generateUuid();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO implementations
         (id, org_id, scope_id, primary_control_id, status, statement,
          responsible_role, sig_response, responsibility_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      org.id,
      scopeId,
      controlRow.id,
      options.status,
      options.statement,
      options.responsibleRole ?? null,
      options.response ?? null,
      options.responsibility,
      timestamp,
      timestamp
    );

  success(`Implementation added for ${options.control}`);
}
