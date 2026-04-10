import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error } from '../../utils/logger.js';
import { propagate } from '../../services/propagation/dispatcher.js';
import type { Actor } from '../../services/audit/logger.js';

const CLI_ACTOR: Actor = { type: 'user', id: 'cli' };

/**
 * `attesting risk create` — create a new risk entry.
 */
export function registerRiskCreate(riskCommand: Command): void {
  riskCommand
    .command('create')
    .description('Create a new risk')
    .requiredOption('--title <title>', 'Risk title')
    .requiredOption('--owner <owner>', 'Risk owner')
    .requiredOption('--likelihood <n>', 'Likelihood (1-5)', parseInt)
    .requiredOption('--impact <n>', 'Impact (1-5)', parseInt)
    .option('--description <text>', 'Risk description')
    .option('--category <category>', 'Risk category')
    .option('--source <source>', 'Risk source')
    .option('--treatment <treatment>', 'Treatment strategy: mitigate, accept, transfer, avoid', 'mitigate')
    .option('--treatment-plan <text>', 'Treatment plan description')
    .option('--json', 'Output as JSON')
    .action(runRiskCreate);
}

interface RiskCreateOptions {
  title: string;
  owner: string;
  likelihood: number;
  impact: number;
  description?: string;
  category?: string;
  source?: string;
  treatment: string;
  treatmentPlan?: string;
  json?: boolean;
}

function runRiskCreate(options: RiskCreateOptions): void {
  const database = db.getDb();

  // Validate likelihood and impact ranges
  if (options.likelihood < 1 || options.likelihood > 5) {
    error('Likelihood must be between 1 and 5.');
    process.exit(1);
  }
  if (options.impact < 1 || options.impact > 5) {
    error('Impact must be between 1 and 5.');
    process.exit(1);
  }

  const validTreatments = ['mitigate', 'accept', 'transfer', 'avoid'];
  if (!validTreatments.includes(options.treatment)) {
    error(`Invalid treatment "${options.treatment}". Must be one of: ${validTreatments.join(', ')}`);
    process.exit(1);
  }

  // Generate risk_id reference
  const count = (database.prepare('SELECT COUNT(*) AS c FROM risks').get() as { c: number }).c;
  const riskRef = `RISK-${String(count + 1).padStart(3, '0')}`;

  const id = generateUuid();
  const timestamp = now();
  const inherentScore = options.likelihood * options.impact;

  database
    .prepare(
      `INSERT INTO risks
         (id, risk_id, title, description, category, source,
          likelihood, impact, inherent_risk_score,
          treatment, treatment_plan, owner, status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .run(
      id,
      riskRef,
      options.title,
      options.description ?? null,
      options.category ?? null,
      options.source ?? null,
      options.likelihood,
      options.impact,
      inherentScore,
      options.treatment,
      options.treatmentPlan ?? null,
      options.owner,
      timestamp,
      timestamp
    );

  // Trigger propagation
  propagate(database, 'risk', id, 'create', CLI_ACTOR, undefined, {
    likelihood: options.likelihood,
    impact: options.impact,
    status: 'open',
  });

  if (options.json) {
    const created = database.prepare('SELECT * FROM risks WHERE id = ?').get(id);
    console.log(JSON.stringify(created, null, 2));
    return;
  }

  success(`Risk created: ${riskRef} — "${options.title}" (ID: ${id})`);
  console.log(`  Inherent score: ${inherentScore}  Treatment: ${options.treatment}  Owner: ${options.owner}`);
}
