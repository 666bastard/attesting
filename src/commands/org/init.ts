import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { warn, success } from '../../utils/logger.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting org init` subcommand on the provided Command.
 */
export function registerOrgInit(orgCommand: Command): void {
  orgCommand
    .command('init')
    .description('Initialize an organization profile')
    .requiredOption('--name <name>', 'Organization name')
    .option('--cage-code <code>', 'DoD CAGE code (optional)')
    .option('--description <desc>', 'Organization description (optional)')
    .action(runOrgInit);
}

interface OrgInitOptions {
  name: string;
  cageCode?: string;
  description?: string;
}

function runOrgInit(options: OrgInitOptions): void {
  const database = db.getDb();

  // Check for an existing organization and warn the user
  const existing = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (existing) {
    warn(
      `An organization already exists: "${existing.name}". ` +
        'Creating an additional organization record.'
    );
  }

  const id = generateUuid();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO organizations (id, name, description, cage_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      options.name,
      options.description ?? null,
      options.cageCode ?? null,
      timestamp,
      timestamp
    );

  success(`Organization initialized: ${options.name}`);
}
