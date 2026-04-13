#!/usr/bin/env node

// Handle EPIPE when piping output to head/tail/grep etc.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { registerOrgInit } from './commands/org/init.js';

/**
 * Reads the version from the nearest package.json so `--version` always
 * reflects the installed package rather than a hardcoded literal.
 */
function readPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // When installed: dist/index.js → ../package.json
    // When running via tsx: src/index.ts → ../package.json
    const candidates = [
      path.join(here, '..', 'package.json'),
      path.join(here, '..', '..', 'package.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.name === 'attesting' && typeof pkg.version === 'string') return pkg.version;
      }
    }
  } catch { /* fall through */ }
  return '0.0.0';
}
import { registerScopeCommands } from './commands/org/scope.js';
import { registerCatalogImport } from './commands/catalog/import.js';
import { registerCatalogList } from './commands/catalog/list.js';
import { registerCatalogInspect } from './commands/catalog/inspect.js';
import { registerCatalogDiff } from './commands/catalog/diff.js';
import { registerCatalogUpdate } from './commands/catalog/update.js';
import { registerCatalogWatch } from './commands/catalog/watch.js';
import { registerCatalogImpact } from './commands/catalog/impact.js';
import { registerCatalogRefresh } from './commands/catalog/refresh.js';
import { registerImportProprietary } from './commands/catalog/import-proprietary.js';
import { registerMappingCreate } from './commands/mapping/create.js';
import { registerMappingImport } from './commands/mapping/import.js';
import { registerMappingList } from './commands/mapping/list.js';
import { registerMappingResolve } from './commands/mapping/resolve.js';
import { registerMappingAutoLink } from './commands/mapping/auto-link.js';
import { registerImplAdd } from './commands/implementation/add.js';
import { registerImplImport } from './commands/implementation/import.js';
import { registerImplList } from './commands/implementation/list.js';
import { registerImplStatus } from './commands/implementation/status.js';
import { registerImplEdit } from './commands/implementation/edit.js';
import { registerExportSig } from './commands/export/sig.js';
import { registerExportOscal } from './commands/export/oscal.js';
import { registerExportCsv } from './commands/export/csv.js';
import { registerExportPdf } from './commands/export/pdf.js';
import { registerExportSoa } from './commands/export/soa.js';
import { registerAssessmentCreate } from './commands/assessment/create.js';
import { registerAssessmentEvaluate } from './commands/assessment/evaluate.js';
import { registerAssessmentPoam } from './commands/assessment/poam.js';
import { registerServe } from './commands/web/serve.js';
import { registerSetup } from './commands/setup/wizard.js';
import { registerRiskCommands } from './commands/risk/index.js';
import { registerScoreCommands } from './commands/score/index.js';
import { registerMonitorCommands } from './commands/monitor/index.js';
import { registerEvidenceCommands } from './commands/evidence/index.js';
import { registerReportCommands } from './commands/report/index.js';
import { registerIntelCommands } from './commands/intel/index.js';
import { registerDriftCommands } from './commands/drift/index.js';
import { registerConnectorCommands } from './commands/connector/index.js';

const program = new Command();

program
  .name('attesting')
  .description('OSCAL-native compliance control platform')
  .version(readPackageVersion());

// ---------------------------------------------------------------
// org commands
// ---------------------------------------------------------------
const orgCommand = program
  .command('org')
  .description('Manage organization profile');

registerOrgInit(orgCommand);

// ---------------------------------------------------------------
// scope commands (top-level: attesting scope <sub>)
// ---------------------------------------------------------------
registerScopeCommands(program);

// ---------------------------------------------------------------
// catalog commands
// ---------------------------------------------------------------
const catalogCommand = program
  .command('catalog')
  .description('Manage control catalogs');

registerCatalogImport(catalogCommand);
registerCatalogList(catalogCommand);
registerCatalogInspect(catalogCommand);
registerCatalogDiff(catalogCommand);
registerCatalogUpdate(catalogCommand);
registerCatalogWatch(catalogCommand);
registerCatalogImpact(catalogCommand);
registerCatalogRefresh(catalogCommand);
registerImportProprietary(catalogCommand);

// ---------------------------------------------------------------
// mapping commands
// ---------------------------------------------------------------
const mappingCommand = program
  .command('mapping')
  .description('Manage cross-framework control mappings');

registerMappingCreate(mappingCommand);
registerMappingImport(mappingCommand);
registerMappingList(mappingCommand);
registerMappingResolve(mappingCommand);
registerMappingAutoLink(mappingCommand);

// ---------------------------------------------------------------
// impl (implementation) commands
// ---------------------------------------------------------------
const implCommand = program
  .command('impl')
  .description('Manage implementation statements');

registerImplAdd(implCommand);
registerImplImport(implCommand);
registerImplList(implCommand);
registerImplStatus(implCommand);
registerImplEdit(implCommand);

// ---------------------------------------------------------------
// export commands
// ---------------------------------------------------------------
const exportCommand = program
  .command('export')
  .description('Export compliance data in various formats');

registerExportSig(exportCommand);
registerExportOscal(exportCommand);
registerExportCsv(exportCommand);
registerExportPdf(exportCommand);
registerExportSoa(exportCommand);

// ---------------------------------------------------------------
// assessment commands
// ---------------------------------------------------------------
const assessmentCommand = program
  .command('assessment')
  .description('Manage compliance assessments and POA&M items');

registerAssessmentCreate(assessmentCommand);
registerAssessmentEvaluate(assessmentCommand);
registerAssessmentPoam(assessmentCommand);

// ---------------------------------------------------------------
// risk commands
// ---------------------------------------------------------------
registerRiskCommands(program);

// ---------------------------------------------------------------
// score commands
// ---------------------------------------------------------------
registerScoreCommands(program);

// ---------------------------------------------------------------
// monitor commands
// ---------------------------------------------------------------
registerMonitorCommands(program);

// ---------------------------------------------------------------
// evidence commands
// ---------------------------------------------------------------
registerEvidenceCommands(program);

// ---------------------------------------------------------------
// report commands
// ---------------------------------------------------------------
registerReportCommands(program);

// ---------------------------------------------------------------
// intel commands
// ---------------------------------------------------------------
registerIntelCommands(program);

// ---------------------------------------------------------------
// drift commands
// ---------------------------------------------------------------
registerDriftCommands(program);

// ---------------------------------------------------------------
// connector commands
// ---------------------------------------------------------------
registerConnectorCommands(program);

// ---------------------------------------------------------------
// web serve command (top-level)
// ---------------------------------------------------------------
registerServe(program);

// ---------------------------------------------------------------
// setup wizard (top-level)
// ---------------------------------------------------------------
registerSetup(program);

program.parse();
