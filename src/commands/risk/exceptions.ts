import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error, info, warn } from '../../utils/logger.js';
import type { Risk, RiskException } from '../../models/risk.js';

/**
 * `attesting risk exceptions` — list, create, or expire risk exceptions.
 */
export function registerRiskExceptions(riskCommand: Command): void {
  riskCommand
    .command('exceptions')
    .description('Manage risk exceptions')
    .argument('[risk-ref]', 'Risk reference (e.g. RISK-001) or UUID — list all if omitted')
    .option('--create', 'Create a new exception')
    .option('--expire <exception-id>', 'Expire an existing exception by ID')
    .option('--justification <text>', 'Justification for the exception')
    .option('--compensating <text>', 'Compensating controls description')
    .option('--approved-by <name>', 'Approver name')
    .option('--expiry-date <date>', 'Expiry date (YYYY-MM-DD)')
    .option('--control <control-id>', 'Specific control the exception applies to')
    .option('--json', 'Output as JSON')
    .action(runRiskExceptions);
}

interface RiskExceptionsOptions {
  create?: boolean;
  expire?: string;
  justification?: string;
  compensating?: string;
  approvedBy?: string;
  expiryDate?: string;
  control?: string;
  json?: boolean;
}

function runRiskExceptions(riskRef: string | undefined, options: RiskExceptionsOptions): void {
  const database = db.getDb();

  // Expire an exception
  if (options.expire) {
    const exc = database
      .prepare('SELECT id, status FROM risk_exceptions WHERE id = ? LIMIT 1')
      .get(options.expire) as Pick<RiskException, 'id' | 'status'> | undefined;

    if (!exc) {
      error(`Exception not found: "${options.expire}"`);
      process.exit(1);
    }

    database
      .prepare("UPDATE risk_exceptions SET status = 'expired' WHERE id = ?")
      .run(exc.id);

    if (options.json) {
      console.log(JSON.stringify({ id: exc.id, status: 'expired' }, null, 2));
      return;
    }

    success(`Exception ${exc.id} expired.`);
    return;
  }

  // Create a new exception
  if (options.create) {
    if (!riskRef) {
      error('Risk reference required when creating an exception.');
      process.exit(1);
    }

    const risk = database
      .prepare('SELECT * FROM risks WHERE risk_id = ? OR id = ? LIMIT 1')
      .get(riskRef, riskRef) as Risk | undefined;

    if (!risk) {
      error(`Risk not found: "${riskRef}"`);
      process.exit(1);
    }

    if (!options.justification) {
      error('--justification is required when creating an exception.');
      process.exit(1);
    }
    if (!options.approvedBy) {
      error('--approved-by is required when creating an exception.');
      process.exit(1);
    }
    if (!options.expiryDate) {
      error('--expiry-date is required when creating an exception (YYYY-MM-DD).');
      process.exit(1);
    }

    // Resolve control if provided
    let controlId: string | null = null;
    if (options.control) {
      const ctrl = database
        .prepare('SELECT id FROM controls WHERE id = ? OR control_id = ? LIMIT 1')
        .get(options.control, options.control) as { id: string } | undefined;

      if (!ctrl) {
        error(`Control not found: "${options.control}"`);
        process.exit(1);
      }
      controlId = ctrl.id;
    }

    const id = generateUuid();
    const timestamp = now();

    database
      .prepare(
        `INSERT INTO risk_exceptions
           (id, risk_id, control_id, justification, compensating_controls,
            approved_by, approved_date, expiry_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        id,
        risk.id,
        controlId,
        options.justification,
        options.compensating ?? null,
        options.approvedBy,
        timestamp,
        options.expiryDate,
        timestamp
      );

    if (options.json) {
      const created = database.prepare('SELECT * FROM risk_exceptions WHERE id = ?').get(id);
      console.log(JSON.stringify(created, null, 2));
      return;
    }

    success(`Exception created for ${risk.risk_id} (ID: ${id})`);
    console.log(`  Approved by: ${options.approvedBy}  Expires: ${options.expiryDate}`);
    return;
  }

  // Default: list exceptions
  let sql = 'SELECT re.*, r.risk_id AS risk_ref FROM risk_exceptions re JOIN risks r ON r.id = re.risk_id';
  const params: unknown[] = [];

  if (riskRef) {
    const risk = database
      .prepare('SELECT id FROM risks WHERE risk_id = ? OR id = ? LIMIT 1')
      .get(riskRef, riskRef) as { id: string } | undefined;

    if (!risk) {
      error(`Risk not found: "${riskRef}"`);
      process.exit(1);
    }
    sql += ' WHERE re.risk_id = ?';
    params.push(risk.id);
  }

  sql += ' ORDER BY re.expiry_date ASC';

  const exceptions = database.prepare(sql).all(...params) as Array<RiskException & { risk_ref: string }>;

  if (options.json) {
    console.log(JSON.stringify(exceptions, null, 2));
    return;
  }

  if (exceptions.length === 0) {
    warn('No exceptions found.');
    return;
  }

  info(`${exceptions.length} exception(s):\n`);

  for (const ex of exceptions) {
    console.log(`  ${ex.risk_ref}  [${ex.status}]  Expires: ${ex.expiry_date}`);
    console.log(`    Justification: ${ex.justification}`);
    console.log(`    Approved by: ${ex.approved_by}  ID: ${ex.id}`);
  }
}
