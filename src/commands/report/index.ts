import { Command } from 'commander';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { success, info, log, error } from '../../utils/logger.js';
import { aggregateReportData } from '../../services/reports/aggregate.js';
import { renderAuditReportPdf } from '../../exporters/pdf-audit-report.js';
import { renderAuditReportDocx } from '../../exporters/docx-audit-report.js';

/** Registers the `attesting report` command group. */
export function registerReportCommands(program: Command): void {
  const cmd = program
    .command('report')
    .description('Generate audit-grade compliance reports (PDF / DOCX)');

  cmd
    .command('audit')
    .description('Generate an audit-ready compliance report')
    .requiredOption('--catalog <ref>', 'Catalog short_name or UUID')
    .option('--scope <ref>', 'Scope name/UUID/"org" (default: org-wide)')
    .option('--format <fmt>', 'Output format: pdf or docx', 'pdf')
    .option('--output <path>', 'Output file path (auto-named if omitted)')
    .option('--trend-days <n>', 'Trend window in days (default 90)', (v) => parseInt(v, 10))
    .option('--json', 'Print report data as JSON instead of generating a file')
    .action(runAudit);
}

interface AuditOptions {
  catalog: string;
  scope?: string;
  format: string;
  output?: string;
  trendDays?: number;
  json?: boolean;
}

async function runAudit(options: AuditOptions): Promise<void> {
  const database = db.getDb();
  const scopeId = resolveScopeRef(database, options.scope);
  if (scopeId === undefined) {
    error(`Scope not found: "${options.scope}"`);
    process.exit(1);
  }
  const catalog = resolveCatalogRef(database, options.catalog);
  if (!catalog) {
    error(`Catalog not found: "${options.catalog}"`);
    process.exit(1);
  }

  const data = aggregateReportData(database, {
    scope_id: scopeId ?? null,
    catalog_id: catalog.id,
    trend_days: options.trendDays ?? 90,
  });

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const format = options.format.toLowerCase();
  if (format !== 'pdf' && format !== 'docx') {
    error(`Invalid format "${options.format}". Must be pdf or docx.`);
    process.exit(1);
  }

  const ts = new Date().toISOString().slice(0, 10);
  const safeScope = (data.scope.name || 'org').replace(/[^a-zA-Z0-9_-]/g, '_');
  const defaultName = `audit-${data.catalog.short_name}-${safeScope}-${ts}.${format}`;
  const outputPath = path.resolve(options.output ?? defaultName);

  try {
    if (format === 'pdf') {
      const result = await renderAuditReportPdf(data, outputPath);
      success(`Audit report generated: ${result.pages} pages, ${formatBytes(result.bytes)}`);
      log(`  Output: ${result.path}`);
    } else {
      const result = await renderAuditReportDocx(data, outputPath);
      success(`Audit report generated: ${formatBytes(result.bytes)}`);
      log(`  Output: ${result.path}`);
    }

    info('');
    info(`  Organization: ${data.organization.name}`);
    info(`  Scope:        ${data.scope.name}`);
    info(`  Catalog:      ${data.catalog.name} (${data.catalog.short_name})`);
    info(`  Score:        ${(data.score?.overall_score ?? 0).toFixed(1)}`);
    info(`  Controls:     ${data.controls.length}`);
  } catch (err: any) {
    error(`Report generation failed: ${err.message}`);
    process.exit(1);
  }
}

function resolveScopeRef(database: any, ref: string | undefined): string | null | undefined {
  if (!ref || ref === 'org' || ref === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(ref) as { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(ref) as { id: string } | undefined;
  if (byName) return byName.id;
  return undefined;
}

function resolveCatalogRef(database: any, ref: string): { id: string; short_name: string; name: string } | null {
  const row = database
    .prepare('SELECT id, short_name, name FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1')
    .get(ref, ref) as { id: string; short_name: string; name: string } | undefined;
  return row ?? null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
