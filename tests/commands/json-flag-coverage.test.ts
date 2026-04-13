import { describe, it, expect, beforeAll } from 'vitest';
import { Command } from 'commander';

/**
 * Phase 5K — CLI --json coverage meta-test.
 *
 * Walks the full commander command tree registered in src/index.ts and
 * asserts that every leaf subcommand advertises a `--json` option, except
 * for a small whitelist of commands where JSON output is semantically
 * not meaningful (interactive wizards, long-running daemons, file-output
 * exporters whose primary output is already a machine-readable file).
 *
 * This guards against future regressions: any new CLI command that forgets
 * `--json` will fail this test.
 */

// Commands exempt from --json requirement. Keep this list as small as possible.
const EXEMPT_PATHS = new Set<string>([
  // Interactive wizards
  'setup',
  // Long-running daemon
  'serve',
  // File-output exporters — they already emit machine-readable files.
  'export csv',
  'export oscal',
  'export sig',
  'export soa',
  'export pdf',
]);

interface LeafCommand {
  path: string;
  hasJson: boolean;
}

function collectLeaves(cmd: Command, pathPrefix = ''): LeafCommand[] {
  const name = cmd.name();
  const currentPath = pathPrefix ? `${pathPrefix} ${name}` : name;
  const children = cmd.commands.filter((c: any) => c.name() !== 'help');

  // Leaf = no child subcommands
  if (children.length === 0) {
    const hasJson = cmd.options.some((opt: any) => opt.long === '--json');
    return [{ path: currentPath, hasJson }];
  }

  return children.flatMap((child) => collectLeaves(child as Command, currentPath));
}

describe('CLI --json coverage (Phase 5K)', () => {
  let program: Command;
  let leaves: LeafCommand[];

  beforeAll(async () => {
    // Suppress commander's default side effects (help printing, process.exit).
    program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });

    // Import the real program builder. We mimic src/index.ts registration here.
    const { registerOrgInit } = await import('../../src/commands/org/init.js');
    const { registerScopeCommands } = await import('../../src/commands/org/scope.js');
    const { registerCatalogImport } = await import('../../src/commands/catalog/import.js');
    const { registerCatalogList } = await import('../../src/commands/catalog/list.js');
    const { registerCatalogInspect } = await import('../../src/commands/catalog/inspect.js');
    const { registerCatalogDiff } = await import('../../src/commands/catalog/diff.js');
    const { registerCatalogUpdate } = await import('../../src/commands/catalog/update.js');
    const { registerCatalogWatch } = await import('../../src/commands/catalog/watch.js');
    const { registerCatalogImpact } = await import('../../src/commands/catalog/impact.js');
    const { registerCatalogRefresh } = await import('../../src/commands/catalog/refresh.js');
    const { registerImportProprietary } = await import('../../src/commands/catalog/import-proprietary.js');
    const { registerMappingCreate } = await import('../../src/commands/mapping/create.js');
    const { registerMappingImport } = await import('../../src/commands/mapping/import.js');
    const { registerMappingList } = await import('../../src/commands/mapping/list.js');
    const { registerMappingResolve } = await import('../../src/commands/mapping/resolve.js');
    const { registerMappingAutoLink } = await import('../../src/commands/mapping/auto-link.js');
    const { registerImplAdd } = await import('../../src/commands/implementation/add.js');
    const { registerImplImport } = await import('../../src/commands/implementation/import.js');
    const { registerImplList } = await import('../../src/commands/implementation/list.js');
    const { registerImplStatus } = await import('../../src/commands/implementation/status.js');
    const { registerImplEdit } = await import('../../src/commands/implementation/edit.js');
    const { registerExportSig } = await import('../../src/commands/export/sig.js');
    const { registerExportOscal } = await import('../../src/commands/export/oscal.js');
    const { registerExportCsv } = await import('../../src/commands/export/csv.js');
    const { registerExportPdf } = await import('../../src/commands/export/pdf.js');
    const { registerExportSoa } = await import('../../src/commands/export/soa.js');
    const { registerAssessmentCreate } = await import('../../src/commands/assessment/create.js');
    const { registerAssessmentEvaluate } = await import('../../src/commands/assessment/evaluate.js');
    const { registerAssessmentPoam } = await import('../../src/commands/assessment/poam.js');
    const { registerRiskCommands } = await import('../../src/commands/risk/index.js');
    const { registerScoreCommands } = await import('../../src/commands/score/index.js');
    const { registerMonitorCommands } = await import('../../src/commands/monitor/index.js');
    const { registerEvidenceCommands } = await import('../../src/commands/evidence/index.js');
    const { registerReportCommands } = await import('../../src/commands/report/index.js');
    const { registerIntelCommands } = await import('../../src/commands/intel/index.js');
    const { registerDriftCommands } = await import('../../src/commands/drift/index.js');
    const { registerConnectorCommands } = await import('../../src/commands/connector/index.js');
    const { registerServe } = await import('../../src/commands/web/serve.js');
    const { registerSetup } = await import('../../src/commands/setup/wizard.js');

    program.name('attesting');

    const orgCommand = program.command('org').description('org');
    registerOrgInit(orgCommand);
    registerScopeCommands(program);

    const catalogCommand = program.command('catalog').description('catalog');
    registerCatalogImport(catalogCommand);
    registerCatalogList(catalogCommand);
    registerCatalogInspect(catalogCommand);
    registerCatalogDiff(catalogCommand);
    registerCatalogUpdate(catalogCommand);
    registerCatalogWatch(catalogCommand);
    registerCatalogImpact(catalogCommand);
    registerCatalogRefresh(catalogCommand);
    registerImportProprietary(catalogCommand);

    const mappingCommand = program.command('mapping').description('mapping');
    registerMappingCreate(mappingCommand);
    registerMappingImport(mappingCommand);
    registerMappingList(mappingCommand);
    registerMappingResolve(mappingCommand);
    registerMappingAutoLink(mappingCommand);

    const implCommand = program.command('impl').description('impl');
    registerImplAdd(implCommand);
    registerImplImport(implCommand);
    registerImplList(implCommand);
    registerImplStatus(implCommand);
    registerImplEdit(implCommand);

    const exportCommand = program.command('export').description('export');
    registerExportSig(exportCommand);
    registerExportOscal(exportCommand);
    registerExportCsv(exportCommand);
    registerExportPdf(exportCommand);
    registerExportSoa(exportCommand);

    const assessmentCommand = program.command('assessment').description('assessment');
    registerAssessmentCreate(assessmentCommand);
    registerAssessmentEvaluate(assessmentCommand);
    registerAssessmentPoam(assessmentCommand);

    registerRiskCommands(program);
    registerScoreCommands(program);
    registerMonitorCommands(program);
    registerEvidenceCommands(program);
    registerReportCommands(program);
    registerIntelCommands(program);
    registerDriftCommands(program);
    registerConnectorCommands(program);
    registerServe(program);
    registerSetup(program);

    leaves = collectLeaves(program);
  });

  it('has discovered a non-trivial command surface', () => {
    expect(leaves.length).toBeGreaterThan(50);
  });

  it('every non-exempt leaf command advertises a --json option', () => {
    const missing: string[] = [];
    for (const leaf of leaves) {
      // Strip "attesting " prefix for matching against EXEMPT_PATHS
      const pathWithoutRoot = leaf.path.replace(/^attesting\s+/, '');
      // Exempt if exact path or any parent segment is in the exempt set
      const isExempt = EXEMPT_PATHS.has(pathWithoutRoot) ||
        [...EXEMPT_PATHS].some((ex) => pathWithoutRoot === ex || pathWithoutRoot.startsWith(ex + ' '));
      if (isExempt) continue;
      if (!leaf.hasJson) missing.push(leaf.path);
    }
    expect(missing, `commands missing --json: ${missing.join(', ')}`).toEqual([]);
  });

  it('exempt commands list stays small and documented', () => {
    // Guard against accidentally growing the exempt list without review.
    expect(EXEMPT_PATHS.size).toBeLessThanOrEqual(10);
  });

  it('every exempt command actually exists in the tree', () => {
    const leafPaths = new Set(
      leaves.map((l) => l.path.replace(/^attesting\s+/, '')),
    );
    for (const exempt of EXEMPT_PATHS) {
      const found = [...leafPaths].some((p) => p === exempt || p.startsWith(exempt + ' '));
      expect(found, `exempt path "${exempt}" not found in command tree`).toBe(true);
    }
  });
});
