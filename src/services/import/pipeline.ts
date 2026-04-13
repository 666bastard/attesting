import type Database from 'better-sqlite3';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { detectFormat } from './detect-format.js';
import { parseFile } from './parsers.js';
import type { ImportFormat, DetectionResult } from './detect-format.js';
import type { ImportPreviewControl } from './parsers.js';

// ── Preview Types ────────────────────────────────────────────

export interface MappingPreview {
  imported_control_id: string;
  maps_to_catalog: string;
  maps_to_control_id: string;
  maps_to_title: string;
  relationship: string;
}

export interface ImportPreview {
  format: ImportFormat;
  detection: DetectionResult;
  catalog_name: string;
  catalog_short_name: string;
  controls: ImportPreviewControl[];
  control_count: number;
  mappings: MappingPreview[];
  mapping_count: number;
  warnings: string[];
  existing_catalog_id?: string;
  would_overwrite: boolean;
}

export interface ImportResult {
  catalog_id: string;
  controls_imported: number;
  mappings_resolved: number;
  warnings: string[];
}

// ── Preview (Dry Run) ────────────────────────────────────────

/**
 * Parse a file and return a preview of what would be imported.
 * Does NOT write to the database.
 */
export async function previewImport(
  db: Database.Database,
  filePath: string,
  filename: string,
  formatOverride?: ImportFormat,
): Promise<ImportPreview> {
  const detection = detectFormat(filename);
  const format = formatOverride ?? detection.format;

  if (format === 'unknown') {
    return emptyPreview(detection, [
      `Could not detect format for "${filename}". Use --format to specify.`,
    ]);
  }

  const parsed = await parseFile(filePath, format);
  if (!parsed) {
    return emptyPreview(detection, [`Failed to parse "${filename}" as ${format}.`]);
  }

  const existing = db
    .prepare('SELECT id FROM catalogs WHERE short_name = ? LIMIT 1')
    .get(parsed.shortName) as { id: string } | undefined;

  const mappings = findMappings(db, parsed.controls);

  return {
    format,
    detection,
    catalog_name: parsed.catalogName,
    catalog_short_name: parsed.shortName,
    controls: parsed.controls,
    control_count: parsed.controls.length,
    mappings,
    mapping_count: mappings.length,
    warnings: parsed.warnings,
    existing_catalog_id: existing?.id,
    would_overwrite: !!existing,
  };
}

// ── Confirmed Import ─────────────────────────────────────────

/**
 * Execute a confirmed import. Writes catalog + controls to the database.
 */
export async function executeImport(
  db: Database.Database,
  filePath: string,
  filename: string,
  formatOverride?: ImportFormat,
  overwrite?: boolean,
): Promise<ImportResult> {
  const detection = detectFormat(filename);
  const format = formatOverride ?? detection.format;
  const parsed = await parseFile(filePath, format);

  if (!parsed) {
    return { catalog_id: '', controls_imported: 0, mappings_resolved: 0, warnings: ['Parse failed'] };
  }

  const warnings: string[] = [...parsed.warnings];
  const ts = now();

  // Handle existing catalog
  let catalogId: string;
  const existing = db
    .prepare('SELECT id FROM catalogs WHERE short_name = ? LIMIT 1')
    .get(parsed.shortName) as { id: string } | undefined;

  if (existing && overwrite) {
    catalogId = existing.id;
    db.prepare('DELETE FROM controls WHERE catalog_id = ?').run(catalogId);
    db.prepare('UPDATE catalogs SET name = ?, updated_at = ? WHERE id = ?')
      .run(parsed.catalogName, ts, catalogId);
    warnings.push(`Overwrote existing catalog "${parsed.shortName}"`);
  } else if (existing) {
    return {
      catalog_id: existing.id, controls_imported: 0, mappings_resolved: 0,
      warnings: [`Catalog "${parsed.shortName}" already exists. Use --overwrite to replace.`],
    };
  } else {
    catalogId = generateUuid();
    db.prepare(
      `INSERT INTO catalogs (id, name, short_name, source_format, version, total_controls, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(catalogId, parsed.catalogName, parsed.shortName, 'proprietary-import', '1.0',
      parsed.controls.length, ts, ts);
  }

  // Insert controls
  const insertCtrl = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, description, family, created_at)
     VALUES (?,?,?,?,?,?,?)`
  );

  let imported = 0;
  db.transaction(() => {
    for (const ctrl of parsed.controls) {
      insertCtrl.run(
        generateUuid(), catalogId, ctrl.control_id, ctrl.title,
        ctrl.description ?? null, ctrl.family ?? null, ts
      );
      imported++;
    }
  })();

  db.prepare('UPDATE catalogs SET total_controls = ? WHERE id = ?').run(imported, catalogId);
  const mappingsResolved = resolveMappings(db, catalogId);

  return { catalog_id: catalogId, controls_imported: imported, mappings_resolved: mappingsResolved, warnings };
}

// ── Mapping Helpers ──────────────────────────────────────────

function findMappings(db: Database.Database, controls: ImportPreviewControl[]): MappingPreview[] {
  const mappings: MappingPreview[] = [];
  const importedIds = new Set(controls.map(c => c.control_id.toLowerCase()));

  const existing = db.prepare(
    `SELECT cs.control_id AS src_ctrl_id, ct.control_id AS tgt_ctrl_id,
            ct.title AS tgt_title, cat.short_name AS tgt_catalog, cm.relationship
     FROM control_mappings cm
     JOIN controls cs ON cm.source_control_id = cs.id
     JOIN controls ct ON cm.target_control_id = ct.id
     JOIN catalogs cat ON ct.catalog_id = cat.id`
  ).all() as any[];

  for (const m of existing) {
    if (importedIds.has(m.src_ctrl_id?.toLowerCase())) {
      mappings.push({
        imported_control_id: m.src_ctrl_id,
        maps_to_catalog: m.tgt_catalog,
        maps_to_control_id: m.tgt_ctrl_id,
        maps_to_title: m.tgt_title,
        relationship: m.relationship ?? 'related',
      });
    }
  }
  return mappings;
}

function resolveMappings(db: Database.Database, catalogId: string): number {
  let resolved = 0;
  const ts = now();
  const imported = db.prepare('SELECT id, control_id FROM controls WHERE catalog_id = ?')
    .all(catalogId) as { id: string; control_id: string }[];

  const ins = db.prepare(
    `INSERT OR IGNORE INTO control_mappings
       (id, source_control_id, target_control_id, relationship, source, created_at)
     VALUES (?,?,?,?,?,?)`
  );

  for (const ctrl of imported) {
    const matches = db.prepare(
      'SELECT id FROM controls WHERE control_id = ? AND catalog_id != ? LIMIT 5'
    ).all(ctrl.control_id, catalogId) as { id: string }[];

    for (const match of matches) {
      ins.run(generateUuid(), ctrl.id, match.id, 'equivalent', 'proprietary-import-auto', ts);
      resolved++;
    }
  }
  return resolved;
}

function emptyPreview(detection: DetectionResult, warnings: string[]): ImportPreview {
  return {
    format: 'unknown', detection, catalog_name: '', catalog_short_name: '',
    controls: [], control_count: 0, mappings: [], mapping_count: 0,
    warnings, would_overwrite: false,
  };
}
