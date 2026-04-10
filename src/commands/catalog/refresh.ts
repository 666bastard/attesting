import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { info, success, error, warn, log } from '../../utils/logger.js';
import { now } from '../../utils/dates.js';
import {
  resolveParams,
  extractPartProse,
  type OscalParam,
} from '../../importers/oscal-catalog.js';

/**
 * Registers the `attesting catalog refresh` subcommand.
 *
 * Re-reads OSCAL source files and updates control descriptions to resolve
 * parameter placeholders ({{ insert: param, ... }}) that were stored as
 * raw markup in older imports.
 */
export function registerCatalogRefresh(catalogCommand: Command): void {
  catalogCommand
    .command('refresh')
    .description(
      'Re-resolve OSCAL parameter placeholders in control descriptions from source files'
    )
    .option(
      '--catalog <shortName>',
      'Refresh a specific catalog (default: all OSCAL catalogs)'
    )
    .option(
      '--data-dir <dir>',
      'Directory containing catalog JSON files',
      'data/catalogs'
    )
    .action(runCatalogRefresh);
}

interface RefreshOptions {
  catalog?: string;
  dataDir: string;
}

interface OscalControl {
  id: string;
  title?: string;
  params?: OscalParam[];
  parts?: Array<{ name: string; prose?: string; parts?: Array<{ name: string; prose?: string }> }>;
  controls?: OscalControl[];
}

interface OscalGroup {
  id?: string;
  title?: string;
  controls?: OscalControl[];
  groups?: OscalGroup[];
}

function runCatalogRefresh(options: RefreshOptions): void {
  const database = db.getDb();
  const dataDir = path.resolve(options.dataDir);

  // Find OSCAL catalogs to refresh
  let catalogs: Array<{ id: string; short_name: string; name: string }>;
  if (options.catalog) {
    const cat = database
      .prepare(
        "SELECT id, short_name, name FROM catalogs WHERE short_name = ? AND source_format = 'oscal'"
      )
      .get(options.catalog) as { id: string; short_name: string; name: string } | undefined;
    if (!cat) {
      error(`OSCAL catalog "${options.catalog}" not found.`);
      process.exit(1);
    }
    catalogs = [cat];
  } else {
    catalogs = database
      .prepare(
        "SELECT id, short_name, name FROM catalogs WHERE source_format = 'oscal' ORDER BY name"
      )
      .all() as Array<{ id: string; short_name: string; name: string }>;
  }

  if (catalogs.length === 0) {
    warn('No OSCAL catalogs found to refresh.');
    return;
  }

  info(`Refreshing ${catalogs.length} OSCAL catalog(s) from ${dataDir}`);

  // Ensure control_params table exists
  database.exec(`CREATE TABLE IF NOT EXISTS control_params (
    id TEXT PRIMARY KEY, control_id TEXT NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
    param_id TEXT NOT NULL, label TEXT, description TEXT, default_value TEXT,
    value TEXT, set_by TEXT, set_at TEXT, UNIQUE(control_id, param_id)
  )`);

  const updateStmt = database.prepare(
    'UPDATE controls SET description = ?, guidance = ? WHERE catalog_id = ? AND control_id = ?'
  );

  // Look up internal UUID for a control
  const lookupControl = database.prepare(
    'SELECT id FROM controls WHERE catalog_id = ? AND control_id = ?'
  );

  const upsertParam = database.prepare(
    `INSERT INTO control_params (id, control_id, param_id, label, description, default_value)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(control_id, param_id) DO UPDATE SET label = excluded.label, description = excluded.description, default_value = excluded.default_value`
  );

  let totalUpdated = 0;
  let totalParams = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Short name → filename mapping for catalogs whose short_name doesn't match the file
  const FILE_ALIASES: Record<string, string> = {
    'nist-800-53-r5-mod': 'nist-800-53-r5-moderate',
    'nist-800-53-r5-priv': 'nist-800-53-r5-privacy',
  };

  for (const cat of catalogs) {
    // Try to find the source JSON file
    const baseName = FILE_ALIASES[cat.short_name] ?? cat.short_name;
    const jsonPath = path.join(dataDir, `${baseName}.json`);
    if (!fs.existsSync(jsonPath)) {
      warn(`  ${cat.short_name}: source file not found at ${jsonPath} — skipping`);
      totalSkipped++;
      continue;
    }

    info(`  ${cat.short_name}: reading ${jsonPath}`);

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } catch (err) {
      error(`  ${cat.short_name}: invalid JSON — ${(err as Error).message}`);
      totalErrors++;
      continue;
    }

    // Extract controls from OSCAL structure
    const oscalCatalog = (data as any).catalog as {
      groups?: OscalGroup[];
      controls?: OscalControl[];
    } | undefined;

    if (!oscalCatalog) {
      warn(`  ${cat.short_name}: no 'catalog' root key — skipping`);
      totalSkipped++;
      continue;
    }

    // Build flat maps: controlId → resolved text, controlId → params
    const controlMap = new Map<string, { description: string | null; guidance: string | null }>();
    const paramMap = new Map<string, OscalParam[]>();

    function processControl(control: OscalControl, inheritedParams?: OscalParam[]): void {
      const allParams = [...(inheritedParams ?? []), ...(control.params ?? [])];
      const rawDesc = extractPartProse(control.parts as any, 'statement');
      const rawGuidance = extractPartProse(control.parts as any, 'guidance');
      const description = resolveParams(rawDesc, allParams);
      const guidance = resolveParams(rawGuidance, allParams);
      controlMap.set(control.id, { description, guidance });

      // Store this control's own params (not inherited)
      if (control.params && control.params.length > 0) {
        paramMap.set(control.id, control.params);
      }

      if (control.controls) {
        for (const child of control.controls) processControl(child, allParams);
      }
    }

    function processGroup(group: OscalGroup): void {
      if (group.controls) {
        for (const ctrl of group.controls) processControl(ctrl);
      }
      if (group.groups) {
        for (const sub of group.groups) processGroup(sub);
      }
    }

    if (oscalCatalog.groups) {
      for (const group of oscalCatalog.groups) processGroup(group);
    }
    if (oscalCatalog.controls) {
      for (const ctrl of oscalCatalog.controls) processControl(ctrl);
    }

    // Update database — descriptions + params
    let catUpdated = 0;
    let catParams = 0;

    const runUpdate = database.transaction(() => {
      for (const [controlId, resolved] of controlMap) {
        const result = updateStmt.run(resolved.description, resolved.guidance, cat.id, controlId);
        if (result.changes > 0) catUpdated++;
      }

      // Upsert params
      for (const [controlId, params] of paramMap) {
        const row = lookupControl.get(cat.id, controlId) as { id: string } | undefined;
        if (!row) continue;
        for (const p of params) {
          const guideline = p.guidelines?.[0]?.prose ?? null;
          const defaultVal = p.select?.choice?.join('; ') ?? p.values?.[0] ?? null;
          upsertParam.run(generateUuid(), row.id, p.id, p.label ?? null, guideline, defaultVal);
          catParams++;
        }
      }
    });

    runUpdate();
    info(`  ${cat.short_name}: ${catUpdated} controls, ${catParams} params`);
    totalUpdated += catUpdated;
    totalParams += catParams;
  }

  log('');
  success(
    `Refresh complete: ${totalUpdated} controls updated, ${totalParams} params loaded, ${totalSkipped} skipped, ${totalErrors} errors`
  );
}
