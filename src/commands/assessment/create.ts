import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error } from '../../utils/logger.js';
import type { Organization } from '../../models/organization.js';

/**
 * Registers the `attesting assessment create` subcommand.
 *
 * Usage:
 *   attesting assessment create \
 *     --name <name> \
 *     --catalog <short-name> \
 *     [--scope <scope_name>] \
 *     [--type self|third-party|audit]
 */
export function registerAssessmentCreate(assessmentCommand: Command): void {
  assessmentCommand
    .command('create')
    .description('Create a new assessment')
    .requiredOption('--name <name>', 'Assessment name')
    .requiredOption('--catalog <short-name>', 'Catalog short name to assess against')
    .option('--scope <scope_name>', 'Scope to assess')
    .option(
      '--type <type>',
      'Assessment type: self, third-party, or audit',
      'self'
    )
    .option('--json', 'Output as JSON')
    .action(runAssessmentCreate);
}

interface AssessmentCreateOptions {
  name: string;
  catalog: string;
  scope?: string;
  type: string;
  json?: boolean;
}

function runAssessmentCreate(options: AssessmentCreateOptions): void {
  const database = db.getDb();

  // Require organization
  const org = database
    .prepare('SELECT id, name FROM organizations LIMIT 1')
    .get() as Pick<Organization, 'id' | 'name'> | undefined;

  if (!org) {
    error('No organization found. Run `attesting org init --name <name>` first.');
    process.exit(1);
  }

  // Look up catalog
  const catalog = database
    .prepare('SELECT id FROM catalogs WHERE short_name = ? LIMIT 1')
    .get(options.catalog) as { id: string } | undefined;

  if (!catalog) {
    error(`Catalog not found: "${options.catalog}"`);
    process.exit(1);
  }

  // Look up scope (optional)
  let scopeId: string | null = null;
  if (options.scope) {
    const scope = database
      .prepare('SELECT id FROM scopes WHERE name = ? LIMIT 1')
      .get(options.scope) as { id: string } | undefined;

    if (!scope) {
      error(`Scope not found: "${options.scope}"`);
      process.exit(1);
    }
    scopeId = scope.id;
  }

  // Validate type
  const validTypes = ['self', 'third-party', 'audit'];
  if (!validTypes.includes(options.type)) {
    error(`Invalid type "${options.type}". Must be one of: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  // Get total control count for this catalog
  const totalControls = (
    database
      .prepare('SELECT COUNT(*) AS cnt FROM controls WHERE catalog_id = ?')
      .get(catalog.id) as { cnt: number }
  ).cnt;

  const id = generateUuid();
  const timestamp = now();

  database
    .prepare(
      `INSERT INTO assessments
         (id, org_id, scope_id, catalog_id, name, assessment_type,
          status, total_controls, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'in-progress', ?, ?, ?)`
    )
    .run(
      id,
      org.id,
      scopeId,
      catalog.id,
      options.name,
      options.type,
      totalControls,
      timestamp,
      timestamp
    );

  if (options.json) {
    const created = database.prepare('SELECT * FROM assessments WHERE id = ?').get(id);
    console.log(JSON.stringify(created, null, 2));
    return;
  }

  success(`Assessment created: "${options.name}" (ID: ${id})`);
  console.log(`  Catalog:  ${options.catalog}  (${totalControls} controls)`);
  if (options.scope) console.log(`  Scope:    ${options.scope}`);
  console.log(`  Type:     ${options.type}`);
}
