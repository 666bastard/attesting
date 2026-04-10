import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { success, error, info, warn } from '../../utils/logger.js';
import type { Risk } from '../../models/risk.js';

/**
 * `attesting risk link` — link risk ↔ controls or risk ↔ assets.
 */
export function registerRiskLink(riskCommand: Command): void {
  riskCommand
    .command('link')
    .description('Link a risk to controls or assets')
    .argument('<risk-ref>', 'Risk reference (e.g. RISK-001) or UUID')
    .option('--control <control-id>', 'Control ID to link')
    .option('--asset <asset-id>', 'Asset ID to link')
    .option('--effectiveness <level>', 'Control effectiveness: full, partial, minimal, unknown', 'partial')
    .option('--notes <text>', 'Notes on the link')
    .option('--list', 'List existing links for this risk')
    .option('--json', 'Output as JSON (applies to --list mode)')
    .action(runRiskLink);
}

interface RiskLinkOptions {
  control?: string;
  asset?: string;
  effectiveness: string;
  notes?: string;
  list?: boolean;
  json?: boolean;
}

function runRiskLink(riskRef: string, options: RiskLinkOptions): void {
  const database = db.getDb();

  // Find the risk
  const risk = database
    .prepare('SELECT * FROM risks WHERE risk_id = ? OR id = ? LIMIT 1')
    .get(riskRef, riskRef) as Risk | undefined;

  if (!risk) {
    error(`Risk not found: "${riskRef}"`);
    process.exit(1);
  }

  // List mode
  if (options.list) {
    const controlLinks = database
      .prepare(
        `SELECT rc.*, c.control_id AS ctrl_ref, c.title AS ctrl_title
         FROM risk_controls rc
         JOIN controls c ON c.id = rc.control_id
         WHERE rc.risk_id = ?`
      )
      .all(risk.id) as Array<{ ctrl_ref: string; ctrl_title: string; effectiveness: string; notes: string | null }>;

    const assetLinks = database
      .prepare(
        `SELECT a.id, a.name, a.platform
         FROM risk_asset_links ral
         JOIN assets a ON a.id = ral.asset_id
         WHERE ral.risk_id = ?`
      )
      .all(risk.id) as Array<{ id: string; name: string; platform: string | null }>;

    if (options.json) {
      console.log(JSON.stringify({ controlLinks, assetLinks }, null, 2));
      return;
    }

    info(`Links for ${risk.risk_id} — "${risk.title}":\n`);

    if (controlLinks.length > 0) {
      console.log('  Controls:');
      for (const cl of controlLinks) {
        console.log(`    ${cl.ctrl_ref}  ${cl.ctrl_title}  (${cl.effectiveness})`);
      }
    } else {
      console.log('  Controls: (none)');
    }

    if (assetLinks.length > 0) {
      console.log('  Assets:');
      for (const al of assetLinks) {
        console.log(`    ${al.name}  (${al.platform ?? 'no platform'})`);
      }
    } else {
      console.log('  Assets: (none)');
    }
    return;
  }

  // Must provide --control or --asset
  if (!options.control && !options.asset) {
    error('Provide --control <id> or --asset <id> to link, or --list to view links.');
    process.exit(1);
  }

  if (options.control) {
    // Verify control exists
    const ctrl = database
      .prepare('SELECT id, control_id, title FROM controls WHERE id = ? OR control_id = ? LIMIT 1')
      .get(options.control, options.control) as { id: string; control_id: string; title: string } | undefined;

    if (!ctrl) {
      error(`Control not found: "${options.control}"`);
      process.exit(1);
    }

    const validEffectiveness = ['full', 'partial', 'minimal', 'unknown'];
    if (!validEffectiveness.includes(options.effectiveness)) {
      error(`Invalid effectiveness "${options.effectiveness}". Must be one of: ${validEffectiveness.join(', ')}`);
      process.exit(1);
    }

    // Check for duplicate
    const existing = database
      .prepare('SELECT id FROM risk_controls WHERE risk_id = ? AND control_id = ?')
      .get(risk.id, ctrl.id);

    if (existing) {
      warn(`Link already exists between ${risk.risk_id} and ${ctrl.control_id}. Updating effectiveness.`);
      database
        .prepare('UPDATE risk_controls SET effectiveness = ?, notes = ? WHERE risk_id = ? AND control_id = ?')
        .run(options.effectiveness, options.notes ?? null, risk.id, ctrl.id);
    } else {
      database
        .prepare('INSERT INTO risk_controls (id, risk_id, control_id, effectiveness, notes) VALUES (?, ?, ?, ?, ?)')
        .run(generateUuid(), risk.id, ctrl.id, options.effectiveness, options.notes ?? null);
    }

    success(`Linked ${risk.risk_id} ↔ ${ctrl.control_id} (effectiveness: ${options.effectiveness})`);
  }

  if (options.asset) {
    // Verify asset exists
    const asset = database
      .prepare('SELECT id, name FROM assets WHERE id = ? OR name = ? LIMIT 1')
      .get(options.asset, options.asset) as { id: string; name: string } | undefined;

    if (!asset) {
      error(`Asset not found: "${options.asset}"`);
      process.exit(1);
    }

    // Check for duplicate
    const existing = database
      .prepare('SELECT risk_id FROM risk_asset_links WHERE risk_id = ? AND asset_id = ?')
      .get(risk.id, asset.id);

    if (existing) {
      warn(`Link already exists between ${risk.risk_id} and asset "${asset.name}".`);
      return;
    }

    database
      .prepare('INSERT INTO risk_asset_links (risk_id, asset_id) VALUES (?, ?)')
      .run(risk.id, asset.id);

    success(`Linked ${risk.risk_id} ↔ asset "${asset.name}"`);
  }
}
