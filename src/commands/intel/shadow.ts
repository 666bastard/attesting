import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, error } from '../../utils/logger.js';
import { generateShadowImpact } from '../../services/intel/shadow-analysis.js';
import type { ShadowReport } from '../../services/intel/shadow-analysis.js';

/**
 * `attesting intel shadow <id>` — display shadow impact analysis.
 */
export function registerIntelShadow(intelCommand: Command): void {
  intelCommand
    .command('shadow <id>')
    .description('Display shadow impact analysis for a manual intel entry')
    .option('--json', 'Output as JSON')
    .action(runIntelShadow);
}

interface IntelShadowOptions {
  json?: boolean;
}

function runIntelShadow(id: string, options: IntelShadowOptions): void {
  const database = db.getDb();

  try {
    const shadow: ShadowReport = generateShadowImpact(database, id);

    if (options.json) {
      console.log(JSON.stringify(shadow, null, 2));
      return;
    }

    info(`Shadow impact analysis:\n`);
    console.log(`  ${shadow.summary}\n`);

    if (shadow.assets_at_risk.length > 0) {
      console.log(`  Assets at risk (${shadow.assets_at_risk.length}):`);
      for (const a of shadow.assets_at_risk) {
        console.log(`    ${a.name}  (${a.platform ?? 'no platform'})`);
      }
      console.log();
    }

    if (shadow.controls_to_review.length > 0) {
      console.log(`  Controls to review (${shadow.controls_to_review.length}):`);
      for (const c of shadow.controls_to_review) {
        console.log(`    ${c.control_id}  Status: ${c.current_status}  Owner: ${c.owner ?? '—'}`);
      }
      console.log();
    }

    if (shadow.risk_score_deltas.length > 0) {
      console.log(`  Risk score changes (${shadow.risk_score_deltas.length}):`);
      for (const d of shadow.risk_score_deltas) {
        const sign = d.delta >= 0 ? '+' : '';
        console.log(`    ${d.risk_title}: ${d.current_residual ?? '?'} → ${d.projected_residual} (${sign}${d.delta})`);
      }
      console.log();
    }

    if (shadow.frameworks_affected.length > 0) {
      console.log(`  Frameworks affected: ${shadow.frameworks_affected.join(', ')}`);
    }

    console.log(`  Alerts that would fire: ${shadow.alerts_would_fire}`);
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}
