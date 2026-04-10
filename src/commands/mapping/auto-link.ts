import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { info, success, error, warn, debug } from '../../utils/logger.js';

/**
 * Registers the `attesting mapping auto-link` subcommand.
 *
 * Reads mapping_references from SIG control metadata and creates
 * control_mappings rows by matching reference IDs to controls in
 * other imported catalogs.
 */
export function registerMappingAutoLink(mappingCommand: Command): void {
  mappingCommand
    .command('auto-link')
    .description(
      'Automatically create cross-framework mappings from SIG Content Library references'
    )
    .requiredOption('--source <shortName>', 'Source catalog short name (e.g. sig-lite-2026)')
    .option('--target <shortName>', 'Limit to a specific target catalog (optional)')
    .option('--dry-run', 'Show what would be created without writing to the database')
    .action(runAutoLink);
}

interface AutoLinkOptions {
  source: string;
  target?: string;
  dryRun?: boolean;
}

interface TargetCatalog {
  id: string;
  short_name: string;
  name: string;
}

interface ControlRow {
  id: string;
  control_id: string;
  metadata: string;
}

interface TargetControl {
  id: string;
  control_id: string;
  catalog_id: string;
}

/**
 * Normalize a control ID for fuzzy matching:
 * - lowercase
 * - strip all whitespace
 * - remove leading zeros from numeric segments (PM-09 → pm-9)
 */
function normalizeControlId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(?<=^|[.\-_])0+(\d)/g, '$1');
}

/**
 * Build a lookup index for a set of target controls.
 * Returns a map: normalizedId → TargetControl (first match wins).
 */
function buildTargetIndex(controls: TargetControl[]): {
  exact: Map<string, TargetControl>;
} {
  const exact = new Map<string, TargetControl>();

  for (const ctrl of controls) {
    const norm = normalizeControlId(ctrl.control_id);
    if (!exact.has(norm)) {
      exact.set(norm, ctrl);
    }
  }

  return { exact };
}

/**
 * Extract the control ID from a SIG reference token.
 * SIG references often include descriptive text after the ID:
 *   "CA-01 POLICY AND PROCEDURES"           → "CA-01"
 *   "PM-14 TESTING, TRAINING, AND MONITORING" → "PM-14"
 *   "03.15.03 Rules of Behavior"            → "03.15.03"
 *   "164.308"                               → "164.308"
 *   "5.3 Segregation of duties"             → "5.3"
 *   "500.02(b)(1)"                          → "500.02(b)(1)"
 *
 * Strategy: match the leading portion that looks like a control ID.
 * Control IDs are alphanumeric with dots, dashes, underscores, parens,
 * colons, and slashes — but don't contain spaces followed by alpha words.
 */
function extractControlId(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '';

  // Match leading control-ID-shaped text:
  // - Alphanumeric segments joined by . - _ / :
  // - Optional parenthetical suffixes like (a), (1), (b)(1)
  // - Stops before a space followed by an alpha word
  const m = trimmed.match(
    /^[A-Za-z0-9]+(?:[.\-_/:][A-Za-z0-9]+)*(?:\([A-Za-z0-9]+\))*/
  );
  return m ? m[0] : trimmed.split(/\s/)[0];
}

/**
 * Returns true if the token looks like a valid control ID
 * (starts with an alphanumeric segment containing at least one digit
 *  or is a known prefix letter like "A", "GV", "ID", etc.).
 * Rejects orphaned title fragments like "other associated assets".
 */
function looksLikeControlId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // Must start with something that contains a digit or is a short alpha prefix
  // followed by a separator (dot, dash, underscore)
  return /^[A-Za-z]{0,5}[\-._]?\d/.test(trimmed) || /^[A-Za-z]{1,3}[\-._]\d/.test(trimmed);
}

/**
 * Try to resolve a single reference string against the target index.
 * Returns the matched TargetControl or null.
 *
 * Matching strategies (tried in order):
 *  a. Exact normalized match
 *  b. After extracting control ID from descriptive text
 *  c. With/without leading zeros (handled by normalizeControlId)
 *  d. With NIST 800-171 prefix mapping (03.01.01 → sp_800_171_03.01.01)
 *  e. ISO hyphen→dot normalization (A-5.9 → A.5.9)
 *  f. Strip trailing parenthetical
 */
function resolveReference(
  ref: string,
  index: ReturnType<typeof buildTargetIndex>,
  catalogShortName: string
): TargetControl | null {
  // Extract the control ID portion (strip descriptive text)
  const controlIdRaw = extractControlId(ref);
  const norm = normalizeControlId(controlIdRaw);

  // Strategy a/b/c: exact match on normalized ID
  const exactMatch = index.exact.get(norm);
  if (exactMatch) return exactMatch;

  // Strategy d: NIST 800-171 prefix mapping
  // SIG says "03.15.03" but DB stores "sp_800_171_03.15.03"
  if (/nist-800-171/i.test(catalogShortName)) {
    const prefixed = normalizeControlId('SP_800_171_' + controlIdRaw);
    const prefixMatch = index.exact.get(prefixed);
    if (prefixMatch) return prefixMatch;
  }

  // Strategy e: ISO hyphen→dot normalization
  // SIG says "A-5.9" but DB stores "A.5.9"
  const dotNorm = norm.replace(/-/g, '.');
  if (dotNorm !== norm) {
    const dotMatch = index.exact.get(dotNorm);
    if (dotMatch) return dotMatch;
  }

  // Strategy f: strip trailing parenthetical like "(a)" or "(1)"
  const withoutParen = norm.replace(/\([^)]*\)$/, '');
  if (withoutParen !== norm) {
    const m = index.exact.get(withoutParen);
    if (m) return m;
  }

  return null;
}

/**
 * Split a SIG reference cell value into individual reference tokens.
 * SIG cells use pipe `|` as the primary delimiter:
 *   "CA-01 POLICY AND PROCEDURES|CA-02 CONTROL ASSESSMENTS"
 * Also handles comma, semicolon, and newline separators.
 */
function splitReferences(raw: string): string[] {
  return raw
    .split(/[|;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Map SIG framework column headers to catalog short_names.
 * The SIG spreadsheet uses verbose headers like "NIST SP-800-53r5.1.1 Nov 2023".
 * We need to match these to imported catalog short_names.
 */
function buildFrameworkCatalogMap(
  frameworkColumns: string[],
  catalogs: TargetCatalog[]
): Map<string, string> {
  const map = new Map<string, string>();

  // Known patterns: map SIG column headers → catalog short_name patterns
  const patterns: Array<{ regex: RegExp; shortNamePattern: RegExp }> = [
    { regex: /nist\s*sp[\s-]*800[\s-]*53/i, shortNamePattern: /nist-800-53/i },
    { regex: /nist\s*sp[\s-]*800[\s-]*171/i, shortNamePattern: /nist-800-171/i },
    { regex: /nist\s*cybersecurity\s*framework\s*2/i, shortNamePattern: /nist-csf-2/i },
    { regex: /nist\s*cybersecurity\s*framework/i, shortNamePattern: /nist-csf/i },
    { regex: /nist\s*privacy/i, shortNamePattern: /nist-pf/i },
    { regex: /iso[\s/]*27001/i, shortNamePattern: /iso-27001/i },
    { regex: /iso[\s/]*27002/i, shortNamePattern: /iso-27002/i },
    { regex: /iso[\s/]*27701/i, shortNamePattern: /iso-27701/i },
    { regex: /iso[\s/]*42001/i, shortNamePattern: /iso-42001/i },
    { regex: /cis\s*critical/i, shortNamePattern: /cis-csc/i },
    { regex: /pci\s*dss/i, shortNamePattern: /pci-dss/i },
    { regex: /hipaa/i, shortNamePattern: /hipaa/i },
    { regex: /cmmc/i, shortNamePattern: /cmmc/i },
    { regex: /fedramp/i, shortNamePattern: /fedramp/i },
    { regex: /gdpr/i, shortNamePattern: /gdpr/i },
    { regex: /csa\s*caiq/i, shortNamePattern: /csa-caiq/i },
    { regex: /csa\s*cloud\s*controls/i, shortNamePattern: /csa-ccm/i },
    { regex: /soc\s*2/i, shortNamePattern: /soc-2/i },
    { regex: /dora/i, shortNamePattern: /dora/i },
    { regex: /nis\s*2/i, shortNamePattern: /nis-2/i },
    { regex: /nist\s*ai/i, shortNamePattern: /nist-ai/i },
    { regex: /nerc/i, shortNamePattern: /nerc/i },
    { regex: /isa\s*62443/i, shortNamePattern: /isa-62443/i },
    { regex: /ffiec/i, shortNamePattern: /ffiec/i },
    { regex: /nydfs/i, shortNamePattern: /nydfs/i },
    { regex: /shared\s*assessments\s*sca/i, shortNamePattern: /sca/i },
  ];

  for (const col of frameworkColumns) {
    for (const { regex, shortNamePattern } of patterns) {
      if (!regex.test(col)) continue;
      const catalog = catalogs.find((c) => shortNamePattern.test(c.short_name));
      if (catalog) {
        map.set(col, catalog.short_name);
        break;
      }
    }
  }

  return map;
}

function runAutoLink(options: AutoLinkOptions): void {
  const database = db.getDb();

  // Validate source catalog exists
  const sourceCatalog = database
    .prepare('SELECT id, short_name, name FROM catalogs WHERE short_name = ?')
    .get(options.source) as TargetCatalog | undefined;

  if (!sourceCatalog) {
    error(`Source catalog "${options.source}" not found.`);
    process.exit(1);
  }

  // Load source controls with metadata
  const sourceControls = database
    .prepare('SELECT id, control_id, metadata FROM controls WHERE catalog_id = ?')
    .all(sourceCatalog.id) as ControlRow[];

  if (sourceControls.length === 0) {
    error(`Source catalog "${options.source}" has no controls.`);
    process.exit(1);
  }

  // Check that at least one control has mapping_references in metadata
  let hasRefs = false;
  for (const ctrl of sourceControls) {
    try {
      const meta = JSON.parse(ctrl.metadata || '{}');
      if (meta.mapping_references && Object.keys(meta.mapping_references).length > 0) {
        hasRefs = true;
        break;
      }
    } catch { /* skip */ }
  }

  if (!hasRefs) {
    error(
      `No mapping_references found in control metadata for "${options.source}".\n` +
      `  The catalog may need to be re-imported to include mapping references.\n` +
      `  Delete it first:  sqlite3 ~/.attesting/attesting.db "DELETE FROM catalogs WHERE short_name='${options.source};"\n` +
      `  Then re-import with: attesting catalog import --format sig ...`
    );
    process.exit(1);
  }

  // Load target catalogs (all except source, or specific one)
  let targetCatalogs: TargetCatalog[];
  if (options.target) {
    const cat = database
      .prepare('SELECT id, short_name, name FROM catalogs WHERE short_name = ?')
      .get(options.target) as TargetCatalog | undefined;
    if (!cat) {
      error(`Target catalog "${options.target}" not found.`);
      process.exit(1);
    }
    targetCatalogs = [cat];
  } else {
    targetCatalogs = database
      .prepare('SELECT id, short_name, name FROM catalogs WHERE short_name != ?')
      .all(options.source) as TargetCatalog[];
  }

  if (targetCatalogs.length === 0) {
    error('No target catalogs found. Import at least one other catalog first.');
    process.exit(1);
  }

  info(`Source: ${sourceCatalog.name} (${sourceControls.length} controls)`);
  info(`Targets: ${targetCatalogs.map((c) => c.short_name).join(', ')}`);
  if (options.dryRun) info('DRY RUN — no changes will be written');

  // Collect all unique framework column names from source metadata
  const allFrameworkColumns = new Set<string>();
  for (const ctrl of sourceControls) {
    try {
      const meta = JSON.parse(ctrl.metadata || '{}');
      if (meta.mapping_references) {
        for (const fw of Object.keys(meta.mapping_references)) {
          allFrameworkColumns.add(fw);
        }
      }
    } catch { /* skip */ }
  }

  // Map framework columns to target catalogs
  const fwToCatalog = buildFrameworkCatalogMap([...allFrameworkColumns], targetCatalogs);

  info(`Framework columns mapped to catalogs:`);
  for (const [fw, shortName] of fwToCatalog) {
    info(`  ${fw} → ${shortName}`);
  }

  const unmappedFrameworks = [...allFrameworkColumns].filter((fw) => !fwToCatalog.has(fw));
  if (unmappedFrameworks.length > 0) {
    debug(
      `Unmapped framework columns (no matching catalog imported): ${unmappedFrameworks.join(', ')}`
    );
  }

  // Build target control indexes per catalog
  const catalogIndexes = new Map<string, ReturnType<typeof buildTargetIndex>>();
  for (const cat of targetCatalogs) {
    if (![...fwToCatalog.values()].includes(cat.short_name)) continue;
    const controls = database
      .prepare('SELECT id, control_id, catalog_id FROM controls WHERE catalog_id = ?')
      .all(cat.id) as TargetControl[];
    catalogIndexes.set(cat.short_name, buildTargetIndex(controls));
  }

  // Prepare insert statement
  const insertMapping = database.prepare(
    `INSERT OR IGNORE INTO control_mappings
       (id, source_control_id, target_control_id, relationship, confidence, notes, source, created_at)
     VALUES (?, ?, ?, 'equivalent', 'high', ?, 'sig-content-library', ?)`
  );

  let totalCreated = 0;
  let totalDuplicates = 0;
  let totalResolved = 0;
  let totalUnresolved = 0;
  const unresolvedSamples: string[] = [];

  const runLink = database.transaction(() => {
    for (const ctrl of sourceControls) {
      let meta: { mapping_references?: Record<string, string> };
      try {
        meta = JSON.parse(ctrl.metadata || '{}');
      } catch {
        continue;
      }

      const refs = meta.mapping_references;
      if (!refs) continue;

      for (const [framework, rawRef] of Object.entries(refs)) {
        const targetShortName = fwToCatalog.get(framework);
        if (!targetShortName) continue;

        const index = catalogIndexes.get(targetShortName);
        if (!index) continue;

        // Split comma/semicolon/newline-separated references
        const tokens = splitReferences(rawRef);

        for (const token of tokens) {
          // Skip tokens that don't look like control IDs (orphaned title fragments
          // from line-wrapped SIG cells, e.g. "other associated assets")
          if (!looksLikeControlId(token)) continue;

          const match = resolveReference(token, index, targetShortName);
          if (match) {
            totalResolved++;
            if (!options.dryRun) {
              const result = insertMapping.run(
                generateUuid(),
                ctrl.id,       // source: SIG control UUID
                match.id,      // target: matched control UUID
                `SIG Content Library: ${framework} → ${token}`,
                now()
              );
              if (result.changes > 0) {
                totalCreated++;
              } else {
                totalDuplicates++;
              }
            } else {
              totalCreated++;
            }
          } else {
            totalUnresolved++;
            if (unresolvedSamples.length < 20) {
              unresolvedSamples.push(`${ctrl.control_id} → ${targetShortName}:${token} (${framework})`);
            }
          }
        }
      }
    }
  });

  runLink();

  // Report
  console.log('');
  success(`${totalCreated} mappings created`);
  if (totalDuplicates > 0) {
    info(`${totalDuplicates} duplicate mappings skipped (already existed)`);
  }
  info(`${totalResolved} references resolved, ${totalUnresolved} unresolved`);

  if (unresolvedSamples.length > 0) {
    console.log('');
    warn(`Sample unresolved references:`);
    for (const sample of unresolvedSamples) {
      info(`  ${sample}`);
    }
    if (totalUnresolved > unresolvedSamples.length) {
      info(`  ... and ${totalUnresolved - unresolvedSamples.length} more`);
    }
  }

  // Summary by target catalog
  if (totalCreated > 0 || totalResolved > 0) {
    console.log('');
    info('Verify with: attesting mapping list --source ' + options.source);
  }
}
