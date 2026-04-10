import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error, log } from '../../utils/logger.js';
import type { Organization, Scope } from '../../models/organization.js';

type ScopeType = 'product' | 'system' | 'service' | 'facility';
const SCOPE_TYPES: ScopeType[] = ['product', 'system', 'service', 'facility'];

/**
 * Registers the `attesting scope` subcommands on the provided Command.
 */
export function registerScopeCommands(program: Command): void {
  const scopeCommand = program
    .command('scope')
    .description('Manage product/system scopes');

  // scope create
  scopeCommand
    .command('create')
    .description('Create a new scope within the current organization')
    .requiredOption('--name <name>', 'Scope name')
    .option('--description <desc>', 'Scope description')
    .option(
      '--type <type>',
      `Scope type (${SCOPE_TYPES.join(', ')})`,
      'product'
    )
    .action(runScopeCreate);

  // scope list
  scopeCommand
    .command('list')
    .description('List all scopes for the current organization')
    .action(runScopeList);
}

interface ScopeCreateOptions {
  name: string;
  description?: string;
  type: string;
}

function runScopeCreate(options: ScopeCreateOptions): void {
  const database = db.getDb();

  // Require at least one organization
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    error(
      'No organization found. Run `attesting org init --name <name>` first.'
    );
    process.exit(1);
  }

  // Validate scope type
  if (!SCOPE_TYPES.includes(options.type as ScopeType)) {
    error(
      `Invalid scope type "${options.type}". Must be one of: ${SCOPE_TYPES.join(', ')}`
    );
    process.exit(1);
  }

  const id = generateUuid();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO scopes (id, org_id, name, description, scope_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      org.id,
      options.name,
      options.description ?? null,
      options.type,
      timestamp,
      timestamp
    );

  success(`Scope created: ${options.name}`);
}

function runScopeList(): void {
  const database = db.getDb();

  // Require at least one organization
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    error(
      'No organization found. Run `attesting org init --name <name>` first.'
    );
    process.exit(1);
  }

  const scopes = database
    .prepare(
      'SELECT id, name, scope_type, description, created_at FROM scopes WHERE org_id = ? ORDER BY created_at ASC'
    )
    .all(org.id) as Pick<
    Scope,
    'id' | 'name' | 'scope_type' | 'description' | 'created_at'
  >[];

  if (scopes.length === 0) {
    log('No scopes defined yet. Use `attesting scope create --name <name>`.');
    return;
  }

  log(`\nScopes for: ${org.name}\n`);
  for (const scope of scopes) {
    const desc = scope.description ? `  — ${scope.description}` : '';
    log(`  ${scope.name} [${scope.scope_type}]${desc}`);
  }
  log('');
}
