import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { success, error } from '../../utils/logger.js';
import { promoteManualIntel } from '../../services/intel/manual-intel.js';

/**
 * `attesting intel promote <id>` — promote provisional intel to confirmed threat.
 */
export function registerIntelPromote(intelCommand: Command): void {
  intelCommand
    .command('promote <id>')
    .description('Promote provisional intel to a confirmed threat input')
    .option('--cve <cve-id>', 'Associate a CVE ID')
    .option('--source-ref <ref>', 'External source reference')
    .option('--corroborated-by <source>', 'Corroboration source', 'manual_confirmation')
    .option('--ttps <list>', 'Comma-separated TTP identifiers')
    .option('--json', 'Output as JSON')
    .action(runIntelPromote);
}

interface IntelPromoteOptions {
  cve?: string;
  sourceRef?: string;
  corroboratedBy: string;
  ttps?: string;
  json?: boolean;
}

function runIntelPromote(id: string, options: IntelPromoteOptions): void {
  const database = db.getDb();

  try {
    const result = promoteManualIntel(database, id, {
      cveId: options.cve,
      sourceRef: options.sourceRef,
      corroboratedBy: options.corroboratedBy,
      ttps: options.ttps ? options.ttps.split(',').map(s => s.trim()) : undefined,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    success(`Intel promoted to threat input (Threat ID: ${result.threat_id})`);
    console.log(`  Propagation events: ${result.propagation_log.length}`);
    for (const entry of result.propagation_log.slice(0, 10)) {
      console.log(`    ${entry.type}: ${JSON.stringify(entry)}`);
    }
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }
}
