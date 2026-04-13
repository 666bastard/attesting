import type Database from 'better-sqlite3';
import { error } from '../../utils/logger.js';

/** Resolve a catalog by short_name or UUID. Exits on failure. */
export function resolveCatalog(database: Database.Database, ref: string): { id: string; short_name: string; name: string } {
  const row = database
    .prepare('SELECT id, short_name, name FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1')
    .get(ref, ref) as { id: string; short_name: string; name: string } | undefined;
  if (!row) {
    error(`Catalog not found: "${ref}"`);
    process.exit(1);
  }
  return row;
}

/**
 * Resolve a scope reference to a scope_id.
 * - undefined / omitted → null (org-wide)
 * - "org" / "__org__"   → null
 * - UUID or name        → looked up in scopes table
 * Exits with an error if a non-empty ref doesn't resolve.
 */
export function resolveScope(database: Database.Database, ref: string | undefined): string | null {
  if (!ref || ref === 'org' || ref === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(ref) as
    | { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(ref) as
    | { id: string } | undefined;
  if (byName) return byName.id;
  error(`Scope not found: "${ref}"`);
  process.exit(1);
}

/** Pretty-print a numeric score or "n/a" for null. */
export function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  return `${n.toFixed(2)}%`;
}
