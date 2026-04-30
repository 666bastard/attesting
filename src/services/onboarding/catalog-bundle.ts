/**
 * Imports the catalog files bundled in `data/catalogs/` keyed by their
 * `shortName`. Used by the onboarding wizard (web + CLI) to turn a list of
 * selected frameworks into populated `catalogs` and `controls` rows.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type Database from 'better-sqlite3';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { importCsvCatalog, type ColumnMapping } from '../../importers/csv-generic.js';
import { importOscalCatalog } from '../../importers/oscal-catalog.js';

export type BundleFormat = 'csv' | 'oscal';

export interface BundleEntry {
  shortName: string;
  name: string;
  publisher: string;
  format: BundleFormat;
  file: string;
  columnMapping?: ColumnMapping;
}

/**
 * Bundled catalogs that ship in `data/catalogs/`. CSVs in this bundle are
 * headerless — every row is data — so they import with `skipHeader: false`.
 */
const BUNDLES: BundleEntry[] = [
  {
    shortName: 'nist-800-171-r3',
    name: 'NIST SP 800-171 Rev 3',
    publisher: 'NIST',
    format: 'oscal',
    file: 'nist-800-171-r3.json',
  },
  {
    shortName: 'cmmc-2.0',
    name: 'CMMC 2.0 Level 2',
    publisher: 'DoD',
    format: 'csv',
    file: 'cmmc-2.0.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'nispom-117',
    name: 'NISPOM 32 CFR 117',
    publisher: 'DoD',
    format: 'csv',
    file: 'nispom-117.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'nist-800-53-r5',
    name: 'NIST SP 800-53 Rev 5',
    publisher: 'NIST',
    format: 'oscal',
    file: 'nist-800-53-r5.json',
  },
  {
    shortName: 'nist-csf-2.0',
    name: 'NIST CSF 2.0',
    publisher: 'NIST',
    format: 'oscal',
    file: 'nist-csf-2.0.json',
  },
  {
    shortName: 'soc2-tsc',
    name: 'SOC 2 TSC',
    publisher: 'AICPA',
    format: 'csv',
    file: 'soc2-tsc.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'pci-dss-4',
    name: 'PCI DSS 4.0',
    publisher: 'PCI SSC',
    format: 'csv',
    file: 'pci-dss-4.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'hipaa-security',
    name: 'HIPAA Security Rule',
    publisher: 'HHS',
    format: 'csv',
    file: 'hipaa-security.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'gdpr',
    name: 'GDPR',
    publisher: 'EU',
    format: 'csv',
    file: 'gdpr.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'eu-ai-act',
    name: 'EU AI Act',
    publisher: 'EU',
    format: 'csv',
    file: 'eu-ai-act.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'ccpa-cpra',
    name: 'CCPA/CPRA',
    publisher: 'State of California',
    format: 'csv',
    file: 'ccpa-cpra.csv',
    columnMapping: { control_id: 'A', title: 'B', description: 'C' },
  },
  {
    shortName: 'nist-800-218',
    name: 'NIST SP 800-218 (SSDF)',
    publisher: 'NIST',
    format: 'oscal',
    file: 'nist-800-218.json',
  },
];

const BUNDLE_INDEX: Map<string, BundleEntry> = new Map(
  BUNDLES.map((b) => [b.shortName, b]),
);

/** Result of a single bundled catalog import. */
export interface BundleImportResult {
  shortName: string;
  status: 'imported' | 'skipped' | 'unknown' | 'missing' | 'error';
  catalogId?: string;
  controlCount?: number;
  errors?: string[];
  message?: string;
}

/**
 * Resolves `data/catalogs/` relative to the package root. Walks up from this
 * file until a `package.json` named "attesting" is found (handles both
 * `dist/services/...` and `src/services/...` layouts).
 */
function resolveCatalogDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'attesting') return path.join(dir, 'data', 'catalogs');
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), 'data', 'catalogs');
}

/** All bundled framework `shortName`s, in declared order. */
export function listBundledCatalogs(): string[] {
  return BUNDLES.map((b) => b.shortName);
}

/**
 * Import one bundled catalog. Idempotent: if a catalog with that `short_name`
 * already exists in the database, returns `{ status: 'skipped' }` without
 * re-importing.
 */
export function importBundledCatalog(
  db: Database.Database,
  shortName: string,
): BundleImportResult {
  const entry = BUNDLE_INDEX.get(shortName);
  if (!entry) {
    return { shortName, status: 'unknown', message: `No bundled catalog for "${shortName}"` };
  }

  const existing = db.prepare('SELECT id FROM catalogs WHERE short_name = ?').get(shortName) as
    | { id: string }
    | undefined;
  if (existing) {
    return { shortName, status: 'skipped', catalogId: existing.id };
  }

  const filePath = path.join(resolveCatalogDir(), entry.file);
  if (!fs.existsSync(filePath)) {
    return { shortName, status: 'missing', message: `Catalog file not found: ${filePath}` };
  }

  const catalogId = generateUuid();
  const ts = now();
  const sourceFormat = entry.format === 'oscal' ? 'oscal' : 'csv';
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, publisher, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(catalogId, entry.name, entry.shortName, sourceFormat, entry.publisher, ts, ts);

  try {
    let imported = 0;
    let errors: string[] = [];
    if (entry.format === 'oscal') {
      const result = importOscalCatalog(filePath, catalogId, db);
      imported = result.imported;
      errors = result.errors;
    } else {
      if (!entry.columnMapping) {
        throw new Error(`Bundle entry "${shortName}" missing columnMapping`);
      }
      const result = importCsvCatalog(filePath, catalogId, entry.columnMapping, {
        skipHeader: false,
      });
      imported = result.imported;
      errors = result.errors;
    }

    db.prepare('UPDATE catalogs SET total_controls = ?, updated_at = ? WHERE id = ?').run(
      imported,
      now(),
      catalogId,
    );

    return {
      shortName,
      status: 'imported',
      catalogId,
      controlCount: imported,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    db.prepare('DELETE FROM catalogs WHERE id = ?').run(catalogId);
    const message = err instanceof Error ? err.message : String(err);
    return { shortName, status: 'error', message };
  }
}

/** Import each `shortName` in order. Continues on individual failures. */
export function importBundledCatalogs(
  db: Database.Database,
  shortNames: string[],
): BundleImportResult[] {
  return shortNames.map((s) => importBundledCatalog(db, s));
}
