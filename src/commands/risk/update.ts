import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { now } from '../../utils/dates.js';
import { success, error } from '../../utils/logger.js';
import { propagate } from '../../services/propagation/dispatcher.js';
import type { Actor } from '../../services/audit/logger.js';
import type { Risk } from '../../models/risk.js';

const CLI_ACTOR: Actor = { type: 'user', id: 'cli' };

/**
 * `attesting risk update` — edit severity, status, owner, or treatment.
 */
export function registerRiskUpdate(riskCommand: Command): void {
  riskCommand
    .command('update')
    .description('Update an existing risk')
    .argument('<risk-ref>', 'Risk reference (e.g. RISK-001) or UUID')
    .option('--title <title>', 'New title')
    .option('--status <status>', 'New status (open, mitigated, closed)')
    .option('--owner <owner>', 'New owner')
    .option('--likelihood <n>', 'New likelihood (1-5)', parseInt)
    .option('--impact <n>', 'New impact (1-5)', parseInt)
    .option('--treatment <treatment>', 'Treatment strategy: mitigate, accept, transfer, avoid')
    .option('--treatment-plan <text>', 'Treatment plan description')
    .option('--json', 'Output as JSON')
    .action(runRiskUpdate);
}

interface RiskUpdateOptions {
  title?: string;
  status?: string;
  owner?: string;
  likelihood?: number;
  impact?: number;
  treatment?: string;
  treatmentPlan?: string;
  json?: boolean;
}

function runRiskUpdate(riskRef: string, options: RiskUpdateOptions): void {
  const database = db.getDb();

  // Find the risk by risk_id or UUID
  const existing = database
    .prepare('SELECT * FROM risks WHERE risk_id = ? OR id = ? LIMIT 1')
    .get(riskRef, riskRef) as Risk | undefined;

  if (!existing) {
    error(`Risk not found: "${riskRef}"`);
    process.exit(1);
  }

  const prev = { ...existing };
  const sets: string[] = [];
  const params: unknown[] = [];

  if (options.title !== undefined) {
    sets.push('title = ?');
    params.push(options.title);
  }
  if (options.status !== undefined) {
    sets.push('status = ?');
    params.push(options.status);
  }
  if (options.owner !== undefined) {
    sets.push('owner = ?');
    params.push(options.owner);
  }
  if (options.likelihood !== undefined) {
    if (options.likelihood < 1 || options.likelihood > 5) {
      error('Likelihood must be between 1 and 5.');
      process.exit(1);
    }
    sets.push('likelihood = ?');
    params.push(options.likelihood);
  }
  if (options.impact !== undefined) {
    if (options.impact < 1 || options.impact > 5) {
      error('Impact must be between 1 and 5.');
      process.exit(1);
    }
    sets.push('impact = ?');
    params.push(options.impact);
  }
  if (options.treatment !== undefined) {
    const validTreatments = ['mitigate', 'accept', 'transfer', 'avoid'];
    if (!validTreatments.includes(options.treatment)) {
      error(`Invalid treatment "${options.treatment}". Must be one of: ${validTreatments.join(', ')}`);
      process.exit(1);
    }
    sets.push('treatment = ?');
    params.push(options.treatment);
  }
  if (options.treatmentPlan !== undefined) {
    sets.push('treatment_plan = ?');
    params.push(options.treatmentPlan);
  }

  if (sets.length === 0) {
    error('No update flags provided. Use --help to see options.');
    process.exit(1);
  }

  // Recalculate inherent score if likelihood or impact changed
  const newLikelihood = options.likelihood ?? existing.likelihood;
  const newImpact = options.impact ?? existing.impact;
  if (options.likelihood !== undefined || options.impact !== undefined) {
    sets.push('inherent_risk_score = ?');
    params.push(newLikelihood * newImpact);
  }

  sets.push('updated_at = ?');
  params.push(now());
  params.push(existing.id);

  database
    .prepare(`UPDATE risks SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);

  // Trigger propagation
  const updated = database.prepare('SELECT * FROM risks WHERE id = ?').get(existing.id);
  propagate(database, 'risk', existing.id, 'update', CLI_ACTOR, prev, updated);

  if (options.json) {
    console.log(JSON.stringify(updated, null, 2));
    return;
  }

  success(`Updated ${existing.risk_id}: "${options.title ?? existing.title}"`);
}
