import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { log, error } from '../../utils/logger.js';
import { resolveControl, type ResolvedMapping } from '../../mappers/resolver.js';

/**
 * Registers the `attesting mapping resolve` subcommand.
 */
export function registerMappingResolve(mappingCommand: Command): void {
  mappingCommand
    .command('resolve <ref>')
    .description('Resolve all mapped equivalents for a control (format: catalog:control_id)')
    .option('--depth <n>', 'Maximum traversal depth (1=direct only, 2=one transitive hop)', '2')
    .option('--json', 'Output as JSON')
    .action(runMappingResolve);
}

interface MappingResolveOptions {
  depth: string;
  json?: boolean;
}

function runMappingResolve(ref: string, options: MappingResolveOptions): void {
  const database = db.getDb();

  // Parse "catalog:control_id" reference
  const colonIdx = ref.indexOf(':');
  if (colonIdx === -1) {
    error(`Invalid reference "${ref}". Expected format: catalog:control_id`);
    process.exit(1);
  }

  const catalogShortName = ref.slice(0, colonIdx).trim();
  const controlNativeId = ref.slice(colonIdx + 1).trim();

  if (!catalogShortName || !controlNativeId) {
    error(`Invalid reference "${ref}". Expected format: catalog:control_id`);
    process.exit(1);
  }

  // Look up the internal UUID
  const row = database
    .prepare(
      `SELECT c.id
         FROM controls c
         JOIN catalogs cat ON c.catalog_id = cat.id
        WHERE cat.short_name = ? AND c.control_id = ?
        LIMIT 1`
    )
    .get(catalogShortName, controlNativeId) as { id: string } | undefined;

  if (!row) {
    error(`Control not found: ${ref}`);
    process.exit(1);
  }

  const maxDepth = parseInt(options.depth, 10) || 2;
  const mappings = resolveControl(row.id, database, maxDepth);

  if (options.json) {
    console.log(JSON.stringify({ ref, mappings }, null, 2));
    return;
  }

  if (mappings.length === 0) {
    log(`No mappings found for ${ref}`);
    return;
  }

  log(`\n${ref}`);
  printMappingTree(mappings, ref);
  log('');
}

/**
 * Prints mappings as an indented tree.
 *
 * Direct mappings appear at the first level. Transitive mappings are grouped
 * under their intermediate node (if present in the path).
 */
function printMappingTree(mappings: ResolvedMapping[], _rootRef: string): void {
  // Separate direct and transitive
  const direct = mappings.filter((m) => !m.isTransitive);
  const transitive = mappings.filter((m) => m.isTransitive);

  direct.forEach((m, idx) => {
    const isLast = idx === direct.length - 1 && transitive.length === 0;
    const branch = isLast ? '  └─' : '  ├─';
    const label = `${m.catalogShortName}:${m.controlNativeId} (${m.relationship}, ${m.confidence}) [direct]`;
    log(`${branch} ${label}`);

    // Find transitive mappings that pass through this node
    const children = transitive.filter(
      (t) => t.path.length > 0 && t.path[t.path.length - 1] === m.controlId
    );

    children.forEach((child, cIdx) => {
      const childIsLast = cIdx === children.length - 1;
      const childBranch = childIsLast ? '      └─' : '      ├─';
      const viaRef = `${m.catalogShortName}:${m.controlNativeId}`;
      log(
        `${childBranch} ${child.catalogShortName}:${child.controlNativeId}` +
          ` (${child.relationship}, ${child.confidence}) [transitive via ${viaRef}]`
      );
    });
  });

  // Any transitive mappings not covered above (depth > 2 or orphaned)
  const coveredTransitive = new Set(
    direct.flatMap((m) =>
      transitive
        .filter((t) => t.path.length > 0 && t.path[t.path.length - 1] === m.controlId)
        .map((t) => t.controlId)
    )
  );

  transitive
    .filter((t) => !coveredTransitive.has(t.controlId))
    .forEach((m) => {
      log(
        `  └─ ${m.catalogShortName}:${m.controlNativeId}` +
          ` (${m.relationship}, ${m.confidence}) [transitive]`
      );
    });
}
