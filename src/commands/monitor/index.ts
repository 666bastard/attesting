import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, log, success, warn, error } from '../../utils/logger.js';
import { runPostureMonitor } from '../../services/monitoring/posture-monitor.js';
import {
  listThresholds,
  upsertThreshold,
  resolveThresholds,
} from '../../services/monitoring/thresholds.js';

/** Registers the `attesting monitor` command group. */
export function registerMonitorCommands(program: Command): void {
  const cmd = program
    .command('monitor')
    .description('Continuous monitoring — score thresholds, deltas, trend alerts');

  registerStatus(cmd);
  registerCheck(cmd);
  registerConfigure(cmd);
  registerThresholds(cmd);
}

// ── monitor status ────────────────────────────────────────

function registerStatus(parent: Command): void {
  parent
    .command('status')
    .description('Show active posture findings and recent alerts')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const database = db.getDb();
      // Use a read-only evaluation — do not raise alerts from a query
      const findings = runPostureMonitor(database);
      if (opts.json) {
        console.log(JSON.stringify(findings, null, 2));
        return;
      }
      info(`Monitoring status — ${findings.checked} snapshot(s) evaluated`);
      log(`  Checked at:        ${findings.checked_at}`);
      log(`  Alerts raised:     ${findings.alerts_created}`);
      log('');
      for (const f of findings.findings) {
        const flags: string[] = [];
        if (f.threshold_breached) flags.push(`${f.threshold_kind?.toUpperCase()} threshold`);
        if (f.delta_breached) flags.push(`Δ${f.delta?.toFixed(1)}`);
        if (f.trend_breached) flags.push(`trend ${f.consecutive_drops}↓`);
        const label = f.catalog_short_name ?? f.catalog_id.substring(0, 8);
        const scope = f.scope_id ?? 'org';
        log(
          `  ${label.padEnd(20)}  ${scope.padEnd(12)}  score=${f.current_score.toFixed(1).padStart(6)}` +
          `  ${flags.length > 0 ? '⚠ ' + flags.join(', ') : 'ok'}`,
        );
      }
    });
}

// ── monitor check ─────────────────────────────────────────

function registerCheck(parent: Command): void {
  parent
    .command('check')
    .description('Run the posture monitor now and raise alerts as needed')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const database = db.getDb();
      const result = runPostureMonitor(database);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      success(`Posture monitor complete`);
      log(`  Snapshots checked: ${result.checked}`);
      log(`  Alerts created:    ${result.alerts_created}`);
      const breaches = result.findings.filter((f) => f.threshold_breached || f.delta_breached || f.trend_breached);
      if (breaches.length > 0) {
        log('');
        warn(`  ${breaches.length} finding(s) breached monitoring thresholds:`);
        for (const b of breaches) {
          log(
            `    ${b.catalog_short_name ?? b.catalog_id}  score=${b.current_score.toFixed(1)}` +
            (b.delta !== null ? `  Δ=${b.delta.toFixed(1)}` : ''),
          );
        }
      }
    });
}

// ── monitor configure ─────────────────────────────────────

function registerConfigure(parent: Command): void {
  parent
    .command('configure')
    .description('Upsert monitoring thresholds for a scope+catalog pair')
    .option('--scope <ref>', 'Scope UUID/name, or "org" for global (default: global)')
    .option('--catalog <ref>', 'Catalog short_name/UUID (omit for scope-wide default)')
    .option('--warning <n>', 'Warning threshold (0-100)', parseFloat)
    .option('--critical <n>', 'Critical threshold (0-100)', parseFloat)
    .option('--delta-warning <n>', 'Delta warning magnitude', parseFloat)
    .option('--delta-critical <n>', 'Delta critical magnitude', parseFloat)
    .option('--trend-window <n>', 'Consecutive drops to trigger trend alert', (v) => parseInt(v, 10))
    .option('--disable', 'Disable this threshold row')
    .option('--json', 'Output as JSON')
    .action(runConfigure);
}

interface ConfigureOptions {
  scope?: string;
  catalog?: string;
  warning?: number;
  critical?: number;
  deltaWarning?: number;
  deltaCritical?: number;
  trendWindow?: number;
  disable?: boolean;
  json?: boolean;
}

function runConfigure(options: ConfigureOptions): void {
  const database = db.getDb();

  const scopeId = resolveScopeRef(database, options.scope);
  if (scopeId === undefined) {
    error(`Scope not found: "${options.scope}"`);
    process.exit(1);
  }
  const catalogId = options.catalog ? resolveCatalogRef(database, options.catalog) : null;
  if (options.catalog && !catalogId) {
    error(`Catalog not found: "${options.catalog}"`);
    process.exit(1);
  }

  const row = upsertThreshold(database, {
    scope_id: scopeId,
    catalog_id: catalogId,
    warning_threshold: options.warning,
    critical_threshold: options.critical,
    delta_warning: options.deltaWarning,
    delta_critical: options.deltaCritical,
    trend_window: options.trendWindow,
    enabled: options.disable ? false : undefined,
  });

  if (options.json) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  success(`Monitoring thresholds updated`);
  log(`  Scope:      ${row.scope_id ?? 'global'}`);
  log(`  Catalog:    ${row.catalog_id ?? 'all'}`);
  log(`  Warning:    ${row.warning_threshold}`);
  log(`  Critical:   ${row.critical_threshold}`);
  log(`  ΔWarning:   ${row.delta_warning}`);
  log(`  ΔCritical:  ${row.delta_critical}`);
  log(`  Trend:      ${row.trend_window} consecutive drops`);
  log(`  Enabled:    ${row.enabled}`);
}

// ── monitor thresholds list / resolve ─────────────────────

function registerThresholds(parent: Command): void {
  parent
    .command('thresholds')
    .description('List configured monitoring thresholds')
    .option('--resolve', 'Resolve effective thresholds for a scope+catalog')
    .option('--scope <ref>', 'Scope UUID/name, or "org"')
    .option('--catalog <ref>', 'Catalog short_name/UUID (required with --resolve)')
    .option('--json', 'Output as JSON')
    .action((opts: { resolve?: boolean; scope?: string; catalog?: string; json?: boolean }) => {
      const database = db.getDb();
      if (opts.resolve) {
        if (!opts.catalog) {
          error('--catalog is required with --resolve');
          process.exit(1);
        }
        const scopeId = resolveScopeRef(database, opts.scope);
        const catalogId = resolveCatalogRef(database, opts.catalog);
        if (!catalogId) { error(`Catalog not found: "${opts.catalog}"`); process.exit(1); }
        const resolved = resolveThresholds(database, scopeId ?? null, catalogId);
        if (opts.json) { console.log(JSON.stringify(resolved, null, 2)); return; }
        info(`Effective thresholds for ${opts.catalog} / ${opts.scope ?? 'org'}:`);
        log(`  warning=${resolved.warning_threshold}  critical=${resolved.critical_threshold}`);
        log(`  delta: warning=${resolved.delta_warning}  critical=${resolved.delta_critical}`);
        log(`  trend_window=${resolved.trend_window}  enabled=${resolved.enabled}`);
        return;
      }
      const all = listThresholds(database);
      if (opts.json) { console.log(JSON.stringify(all, null, 2)); return; }
      if (all.length === 0) {
        warn('No thresholds configured — monitor is using built-in defaults.');
        return;
      }
      info(`${all.length} threshold row(s):`);
      for (const t of all) {
        log(
          `  ${(t.scope_id ?? 'global').padEnd(12)}  ${(t.catalog_id ?? 'all').padEnd(12)}` +
          `  warn=${t.warning_threshold}  crit=${t.critical_threshold}  Δwarn=${t.delta_warning}` +
          `  Δcrit=${t.delta_critical}  trend=${t.trend_window}  ${t.enabled ? '✓' : '✗'}`,
        );
      }
    });
}

// ── helpers ───────────────────────────────────────────────

function resolveScopeRef(database: any, ref: string | undefined): string | null | undefined {
  if (!ref || ref === 'org' || ref === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(ref) as { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(ref) as { id: string } | undefined;
  if (byName) return byName.id;
  return undefined;
}

function resolveCatalogRef(database: any, ref: string): string | null {
  const row = database
    .prepare('SELECT id FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1')
    .get(ref, ref) as { id: string } | undefined;
  return row?.id ?? null;
}
