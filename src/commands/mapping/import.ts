import { Command } from 'commander';
import * as path from 'path';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn } from '../../utils/logger.js';
import { parseCsv } from '../../importers/csv-generic.js';
import * as fs from 'fs';

/**
 * Registers the `attesting mapping import` subcommand.
 */
export function registerMappingImport(mappingCommand: Command): void {
  mappingCommand
    .command('import')
    .description('Bulk import control mappings from a CSV file')
    .requiredOption('--format <format>', 'Import format (csv)')
    .requiredOption('--file <file>', 'Path to the CSV file')
    .requiredOption('--source-catalog <shortName>', 'Source catalog short name')
    .requiredOption('--target-catalog <shortName>', 'Target catalog short name')
    .action(runMappingImport);
}

interface MappingImportOptions {
  format: string;
  file: string;
  sourceCatalog: string;
  targetCatalog: string;
}

function runMappingImport(options: MappingImportOptions): void {
  if (options.format !== 'csv') {
    error(`Unsupported format "${options.format}". Supported: csv`);
    process.exit(1);
  }

  const database = db.getDb();
  const filePath = path.resolve(options.file);

  info(`Importing mappings from: ${filePath}`);
  info(`Source catalog: ${options.sourceCatalog}  →  Target catalog: ${options.targetCatalog}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const rows = parseCsv(content);

  if (rows.length < 2) {
    error('CSV file is empty or has no data rows.');
    process.exit(1);
  }

  // Parse header row to find column indices
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colIdx = (name: string): number => header.indexOf(name);

  const idxSource = colIdx('source_control_id');
  const idxTarget = colIdx('target_control_id');
  const idxRel = colIdx('relationship');
  const idxConf = colIdx('confidence');
  const idxNotes = colIdx('notes');

  if (idxSource === -1 || idxTarget === -1) {
    error('CSV must have at minimum "source_control_id" and "target_control_id" columns.');
    process.exit(1);
  }

  // Prepare lookup statement
  const lookupControl = database.prepare(
    `SELECT c.id
       FROM controls c
       JOIN catalogs cat ON c.catalog_id = cat.id
      WHERE cat.short_name = ? AND c.control_id = ?
      LIMIT 1`
  );

  // Use INSERT OR IGNORE to handle duplicates gracefully
  const insertMapping = database.prepare(
    `INSERT OR IGNORE INTO control_mappings
       (id, source_control_id, target_control_id, relationship, confidence, notes, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`
  );

  const dataRows = rows.slice(1);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const runImport = database.transaction(() => {
    dataRows.forEach((row, i) => {
      const rowNum = i + 2; // 1-based, accounting for header

      const sourceId = row[idxSource]?.trim();
      const targetId = row[idxTarget]?.trim();

      if (!sourceId || !targetId) {
        errors.push(`Row ${rowNum}: missing source_control_id or target_control_id`);
        return;
      }

      const sourceRow = lookupControl.get(options.sourceCatalog, sourceId) as { id: string } | undefined;
      if (!sourceRow) {
        warn(`Row ${rowNum}: source control not found: ${options.sourceCatalog}:${sourceId} — skipping`);
        skipped++;
        return;
      }

      const targetRow = lookupControl.get(options.targetCatalog, targetId) as { id: string } | undefined;
      if (!targetRow) {
        warn(`Row ${rowNum}: target control not found: ${options.targetCatalog}:${targetId} — skipping`);
        skipped++;
        return;
      }

      const relationship = (idxRel !== -1 && row[idxRel]?.trim()) || 'equivalent';
      const confidence = (idxConf !== -1 && row[idxConf]?.trim()) || 'high';
      const notes = (idxNotes !== -1 && row[idxNotes]?.trim()) || null;

      try {
        const result = insertMapping.run(
          generateUuid(),
          sourceRow.id,
          targetRow.id,
          relationship,
          confidence,
          notes,
          now()
        );
        if (result.changes > 0) {
          imported++;
        } else {
          // INSERT OR IGNORE — duplicate row
          skipped++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${rowNum}: ${msg}`);
      }
    });
  });

  runImport();

  for (const e of errors) {
    error(e);
  }

  success(
    `Mapping import complete: ${imported} imported, ${skipped} skipped, ${errors.length} errors`
  );
}
