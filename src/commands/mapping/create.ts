import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { success, error } from '../../utils/logger.js';

/**
 * Parses a "catalog:control_id" reference into its two parts.
 * Returns null if the format is invalid.
 */
function parseCatalogControlRef(ref: string): { catalog: string; controlId: string } | null {
  const colonIdx = ref.indexOf(':');
  if (colonIdx === -1) return null;
  const catalog = ref.slice(0, colonIdx).trim();
  const controlId = ref.slice(colonIdx + 1).trim();
  if (!catalog || !controlId) return null;
  return { catalog, controlId };
}

/**
 * Looks up the internal control UUID given a catalog short_name and framework-native control_id.
 * Returns null if not found.
 */
function lookupControlUuid(
  catalogShortName: string,
  controlNativeId: string,
  database: import('better-sqlite3').Database
): string | null {
  const row = database
    .prepare(
      `SELECT c.id
         FROM controls c
         JOIN catalogs cat ON c.catalog_id = cat.id
        WHERE cat.short_name = ? AND c.control_id = ?
        LIMIT 1`
    )
    .get(catalogShortName, controlNativeId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Registers the `attesting mapping create` subcommand.
 */
export function registerMappingCreate(mappingCommand: Command): void {
  mappingCommand
    .command('create')
    .description('Create a control-to-control mapping')
    .requiredOption('--source <ref>', 'Source control reference: catalog:control_id')
    .requiredOption('--target <ref>', 'Target control reference: catalog:control_id')
    .option('--relationship <rel>', 'Relationship type (equivalent|subset|superset|related|intersects)', 'equivalent')
    .option('--confidence <conf>', 'Confidence level (high|medium|low)', 'high')
    .option('--notes <text>', 'Explanation of the mapping relationship')
    .action(runMappingCreate);
}

interface MappingCreateOptions {
  source: string;
  target: string;
  relationship: string;
  confidence: string;
  notes?: string;
}

function runMappingCreate(options: MappingCreateOptions): void {
  const database = db.getDb();

  const sourceRef = parseCatalogControlRef(options.source);
  if (!sourceRef) {
    error(`Invalid source reference "${options.source}". Expected format: catalog:control_id`);
    process.exit(1);
  }

  const targetRef = parseCatalogControlRef(options.target);
  if (!targetRef) {
    error(`Invalid target reference "${options.target}". Expected format: catalog:control_id`);
    process.exit(1);
  }

  const sourceUuid = lookupControlUuid(sourceRef.catalog, sourceRef.controlId, database);
  if (!sourceUuid) {
    error(`Source control not found: ${options.source}`);
    process.exit(1);
  }

  const targetUuid = lookupControlUuid(targetRef.catalog, targetRef.controlId, database);
  if (!targetUuid) {
    error(`Target control not found: ${options.target}`);
    process.exit(1);
  }

  const id = generateUuid();
  const timestamp = now();

  try {
    database
      .prepare(
        `INSERT INTO control_mappings
           (id, source_control_id, target_control_id, relationship, confidence, notes, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`
      )
      .run(
        id,
        sourceUuid,
        targetUuid,
        options.relationship,
        options.confidence,
        options.notes ?? null,
        timestamp
      );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      error(`A mapping between ${options.source} and ${options.target} already exists.`);
    } else {
      error(`Failed to create mapping: ${msg}`);
    }
    process.exit(1);
  }

  success(`Mapping created: ${options.source} -> ${options.target} (${options.relationship}, ${options.confidence})`);
}
