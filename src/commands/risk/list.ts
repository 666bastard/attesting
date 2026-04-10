import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, warn } from '../../utils/logger.js';
import type { Risk } from '../../models/risk.js';

/**
 * `attesting risk list` — list risk register with filters.
 */
export function registerRiskList(riskCommand: Command): void {
  riskCommand
    .command('list')
    .description('List risks in the register')
    .option('--status <status>', 'Filter by status (open, closed, mitigated)')
    .option('--severity <severity>', 'Filter by inherent score threshold (e.g. 10)')
    .option('--owner <owner>', 'Filter by owner (substring match)')
    .option('--source-type <type>', 'Filter by source_type (threat_input, control_gap, etc.)')
    .option('--category <category>', 'Filter by category')
    .option('--above-appetite', 'Only show risks above the matrix appetite threshold')
    .option('--json', 'Output as JSON')
    .action(runRiskList);
}

interface RiskListOptions {
  status?: string;
  severity?: string;
  owner?: string;
  sourceType?: string;
  category?: string;
  aboveAppetite?: boolean;
  json?: boolean;
}

function runRiskList(options: RiskListOptions): void {
  const database = db.getDb();

  let sql = 'SELECT * FROM risks WHERE 1=1';
  const params: unknown[] = [];

  if (options.status) {
    sql += ' AND status = ?';
    params.push(options.status);
  }
  if (options.severity) {
    const threshold = parseInt(options.severity, 10);
    sql += ' AND (likelihood * impact) >= ?';
    params.push(threshold);
  }
  if (options.owner) {
    sql += ' AND owner LIKE ?';
    params.push(`%${options.owner}%`);
  }
  if (options.sourceType) {
    sql += ' AND source_type = ?';
    params.push(options.sourceType);
  }
  if (options.category) {
    sql += ' AND category = ?';
    params.push(options.category);
  }
  if (options.aboveAppetite) {
    sql += ' AND (likelihood * impact) > (SELECT appetite_threshold FROM risk_matrix LIMIT 1)';
  }

  sql += ' ORDER BY (likelihood * impact) DESC';

  const risks = database.prepare(sql).all(...params) as Risk[];

  if (options.json) {
    console.log(JSON.stringify(risks, null, 2));
    return;
  }

  if (risks.length === 0) {
    warn('No risks found matching filters.');
    return;
  }

  info(`${risks.length} risk(s) found:\n`);

  for (const r of risks) {
    const score = r.likelihood * r.impact;
    const residual = r.residual_risk_score ?? score;
    console.log(
      `  ${r.risk_id}  ${r.title}`
    );
    console.log(
      `    Status: ${r.status}  Owner: ${r.owner}  Inherent: ${score}  Residual: ${residual}  Treatment: ${r.treatment}`
    );
  }
}
