import type Database from 'better-sqlite3';
import type { PropagationContext } from './types.js';
import { logEntry } from './types.js';
import { snapshotScore } from '../scoring/snapshot.js';

/**
 * Phase 8A propagation handler.
 *
 * When an implementation or evidence row changes, recompute and persist
 * the compliance score for every (catalog, scope) pair that entity affects.
 *
 * Logic:
 *   1. Resolve the primary_control_id for the changed entity.
 *   2. Look up the catalog that owns the control.
 *   3. Determine the affected scopes: whatever scope the implementation
 *      targets (or NULL = org-wide).
 *   4. Call snapshotScore() for each (catalog, scope) pair.
 *
 * Idempotent and dry-run aware: in dry-run mode we log the intended
 * recalculation without writing anything.
 */

export function recalculateScoreForImplementation(
  db: Database.Database,
  ctx: PropagationContext,
  implementationId: string,
): void {
  const row = db.prepare(`
    SELECT i.id, i.scope_id, c.catalog_id, cat.short_name
    FROM implementations i
    JOIN controls c ON i.primary_control_id = c.id
    JOIN catalogs cat ON c.catalog_id = cat.id
    WHERE i.id = ?
  `).get(implementationId) as
    | { id: string; scope_id: string | null; catalog_id: string; short_name: string }
    | undefined;

  if (!row) return;
  recalcPairs(db, ctx, [{ catalogId: row.catalog_id, scopeId: row.scope_id, catalogShort: row.short_name }]);
}

export function recalculateScoreForEvidence(
  db: Database.Database,
  ctx: PropagationContext,
  evidenceId: string,
): void {
  const row = db.prepare(`
    SELECT i.scope_id, c.catalog_id, cat.short_name
    FROM evidence e
    JOIN implementations i ON e.implementation_id = i.id
    JOIN controls c ON i.primary_control_id = c.id
    JOIN catalogs cat ON c.catalog_id = cat.id
    WHERE e.id = ?
  `).get(evidenceId) as
    | { scope_id: string | null; catalog_id: string; short_name: string }
    | undefined;

  if (!row) return;
  recalcPairs(db, ctx, [{ catalogId: row.catalog_id, scopeId: row.scope_id, catalogShort: row.short_name }]);
}

export function recalculateScoreForAssessment(
  db: Database.Database,
  ctx: PropagationContext,
  assessmentId: string,
): void {
  const row = db.prepare(`
    SELECT a.scope_id, a.catalog_id, cat.short_name
    FROM assessments a
    JOIN catalogs cat ON a.catalog_id = cat.id
    WHERE a.id = ?
  `).get(assessmentId) as
    | { scope_id: string | null; catalog_id: string; short_name: string }
    | undefined;

  if (!row) return;
  recalcPairs(db, ctx, [{ catalogId: row.catalog_id, scopeId: row.scope_id, catalogShort: row.short_name }]);
}

// ── internal ──────────────────────────────────────────────

interface Pair {
  catalogId: string;
  scopeId: string | null;
  catalogShort: string;
}

function recalcPairs(db: Database.Database, ctx: PropagationContext, pairs: Pair[]): void {
  // Dedupe
  const seen = new Set<string>();
  const unique = pairs.filter(p => {
    const key = `${p.catalogId}|${p.scopeId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const p of unique) {
    if (ctx.dryRun) {
      logEntry(ctx, 'score_recalc_would_run', {
        catalog_id: p.catalogId, catalog_short: p.catalogShort, scope_id: p.scopeId,
      });
      continue;
    }

    const snapshot = snapshotScore(db, p.catalogId, p.scopeId, { trigger: 'propagate' });
    logEntry(ctx, 'score_recalculated', {
      catalog_id: p.catalogId,
      catalog_short: p.catalogShort,
      scope_id: p.scopeId,
      overall_score: snapshot.overall_score,
    });
  }
}
