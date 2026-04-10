import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, error } from '../../utils/logger.js';
import { submitManualIntel } from '../../services/intel/manual-intel.js';
import type { ShadowReport } from '../../services/intel/shadow-analysis.js';

/**
 * `attesting intel submit` — submit manual intel as provisional.
 */
export function registerIntelSubmit(intelCommand: Command): void {
  intelCommand
    .command('submit')
    .description('Submit manual threat intelligence (provisional)')
    .requiredOption('--title <title>', 'Intel title')
    .requiredOption('--description <text>', 'Description of the threat')
    .option('--severity <severity>', 'Severity estimate: info, low, medium, high, critical', 'medium')
    .option('--type <type>', 'Intel type: threat, vulnerability, campaign, regulatory', 'threat')
    .option('--source <text>', 'Source description (where you learned about this)')
    .option('--platforms <list>', 'Comma-separated affected platforms (e.g. aws,linux)')
    .option('--controls <list>', 'Comma-separated affected control IDs (e.g. AC-2,IA-5)')
    .option('--deadline-days <n>', 'Corroboration deadline in days', '30')
    .option('--submitted-by <owner-id>', 'Owner ID of submitter')
    .option('--json', 'Output as JSON')
    .action(runIntelSubmit);
}

interface IntelSubmitOptions {
  title: string;
  description: string;
  severity: string;
  type: string;
  source?: string;
  platforms?: string;
  controls?: string;
  deadlineDays: string;
  submittedBy?: string;
  json?: boolean;
}

function runIntelSubmit(options: IntelSubmitOptions): void {
  const database = db.getDb();

  const validSeverities = ['info', 'low', 'medium', 'high', 'critical'];
  if (!validSeverities.includes(options.severity)) {
    error(`Invalid severity "${options.severity}". Must be one of: ${validSeverities.join(', ')}`);
    process.exit(1);
  }

  try {
    const result = submitManualIntel(database, {
      title: options.title,
      description: options.description,
      severityEstimate: options.severity,
      intelType: options.type,
      sourceDescription: options.source,
      affectedPlatformsEst: options.platforms ? options.platforms.split(',').map(s => s.trim()) : [],
      affectedControlsEst: options.controls ? options.controls.split(',').map(s => s.trim()) : [],
      corroborationDeadlineDays: parseInt(options.deadlineDays, 10),
      submittedBy: options.submittedBy,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    success(`Intel submitted: "${options.title}" (ID: ${result.id})`);
    console.log(`  Status: ${result.status}  Corroboration deadline: ${result.corroboration_deadline}`);

    const shadow = result.shadow_impact as ShadowReport;
    console.log(`\n  Shadow impact analysis:`);
    console.log(`    ${shadow.summary}`);
    if (shadow.assets_at_risk.length > 0) {
      console.log(`    Assets at risk: ${shadow.assets_at_risk.map(a => a.name).join(', ')}`);
    }
    if (shadow.controls_to_review.length > 0) {
      console.log(`    Controls to review: ${shadow.controls_to_review.map(c => c.control_id).join(', ')}`);
    }
    if (shadow.risk_score_deltas.length > 0) {
      console.log(`    Risk score changes:`);
      for (const d of shadow.risk_score_deltas) {
        const sign = d.delta >= 0 ? '+' : '';
        console.log(`      ${d.risk_title}: ${d.current_residual ?? '?'} → ${d.projected_residual} (${sign}${d.delta})`);
      }
    }
    if (shadow.frameworks_affected.length > 0) {
      console.log(`    Frameworks affected: ${shadow.frameworks_affected.join(', ')}`);
    }
    console.log(`    Alerts that would fire: ${shadow.alerts_would_fire}`);
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}
