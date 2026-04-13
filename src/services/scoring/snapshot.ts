import type Database from 'better-sqlite3';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import { calculateScore, type ComputedScore } from './compliance-score.js';
import {
  DEFAULT_WEIGHTS,
  type ComplianceScore,
  type ComplianceScoreHistoryEntry,
  type FamilyBreakdown,
  type ScoringWeights,
} from '../../models/compliance-score.js';

/**
 * Snapshot, persist, and query compliance scores.
 *
 * `snapshotScore` calculates then stores the latest score (one row per
 * scope+catalog in `compliance_scores`, plus a time-series append to
 * `compliance_score_history`).
 */

export interface SnapshotOptions {
  trigger?: 'manual' | 'propagate' | 'scheduled';
  weights?: ScoringWeights;
}

/** Calculate and persist a score. Returns the fully hydrated row. */
export function snapshotScore(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null = null,
  options: SnapshotOptions = {},
): ComplianceScore {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const trigger = options.trigger ?? 'manual';
  const computed = calculateScore(db, catalogId, scopeId, weights);

  const id = generateUuid();
  const calculatedAt = now();

  const persist = db.transaction(() => {
    deleteExisting(db, catalogId, scopeId);
    insertSnapshot(db, id, calculatedAt, computed);
    insertHistory(db, catalogId, scopeId, calculatedAt, computed, trigger);
  });
  persist();

  return { id, calculated_at: calculatedAt, ...computed };
}

/**
 * Snapshot every (catalog, scope) combination affected by a propagation event.
 * When scopeIds is empty, org-wide scores (scope_id = NULL) are refreshed.
 */
export function snapshotCatalogsForScope(
  db: Database.Database,
  catalogIds: string[],
  scopeIds: Array<string | null>,
  options: SnapshotOptions = {},
): ComplianceScore[] {
  const scopes = scopeIds.length > 0 ? scopeIds : [null];
  const out: ComplianceScore[] = [];
  for (const catalogId of catalogIds) {
    for (const scopeId of scopes) {
      out.push(snapshotScore(db, catalogId, scopeId, options));
    }
  }
  return out;
}

/** Fetch the latest persisted snapshot for a (scope, catalog) pair. */
export function getLatestScore(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null = null,
): ComplianceScore | null {
  const row = db.prepare(`
    SELECT * FROM compliance_scores
    WHERE catalog_id = ? AND ${scopeFilter(scopeId)}
    LIMIT 1
  `).get(...scopeParams(catalogId, scopeId)) as any | undefined;

  return row ? hydrateScore(row) : null;
}

/** Fetch all latest snapshots for a given scope (one per catalog). */
export function getScoresForScope(
  db: Database.Database,
  scopeId: string | null = null,
): ComplianceScore[] {
  const rows = db.prepare(`
    SELECT cs.*, cat.short_name AS catalog_short_name, cat.name AS catalog_name
    FROM compliance_scores cs
    JOIN catalogs cat ON cs.catalog_id = cat.id
    WHERE ${scopeId ? 'cs.scope_id = ?' : 'cs.scope_id IS NULL'}
    ORDER BY cat.short_name
  `).all(...(scopeId ? [scopeId] : [])) as any[];
  return rows.map(hydrateScore);
}

/**
 * Query score history for a (scope, catalog) pair within a lookback window.
 * `sinceDays` defaults to 90.
 */
export function getScoreHistory(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null = null,
  sinceDays: number = 90,
): ComplianceScoreHistoryEntry[] {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM compliance_score_history
    WHERE catalog_id = ?
      AND ${scopeFilter(scopeId)}
      AND calculated_at >= ?
    ORDER BY calculated_at ASC, rowid ASC
  `).all(...scopeParams(catalogId, scopeId), since) as any[];

  return rows.map(r => ({
    id: r.id,
    scope_id: r.scope_id,
    catalog_id: r.catalog_id,
    overall_score: r.overall_score,
    coverage_score: r.coverage_score,
    evidence_score: r.evidence_score,
    assessment_score: r.assessment_score,
    family_breakdown: parseJson(r.family_breakdown),
    trigger: r.trigger,
    calculated_at: r.calculated_at,
  }));
}

// ── Internals ──────────────────────────────────────────────

function deleteExisting(db: Database.Database, catalogId: string, scopeId: string | null): void {
  db.prepare(`
    DELETE FROM compliance_scores
    WHERE catalog_id = ? AND ${scopeFilter(scopeId)}
  `).run(...scopeParams(catalogId, scopeId));
}

function insertSnapshot(
  db: Database.Database,
  id: string,
  calculatedAt: string,
  s: ComputedScore,
): void {
  db.prepare(`
    INSERT INTO compliance_scores (
      id, scope_id, catalog_id,
      overall_score, coverage_score, evidence_score, assessment_score,
      coverage_weight, evidence_weight, assessment_weight,
      total_controls, implemented_count, partial_count, planned_count,
      alternative_count, not_implemented_count, not_applicable_count,
      fresh_evidence_count, stale_evidence_count, total_evidence_count,
      satisfied_assessment_count, partial_assessment_count,
      not_satisfied_assessment_count, total_assessment_count,
      family_breakdown, calculated_at
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
    )
  `).run(
    id, s.scope_id, s.catalog_id,
    s.overall_score, s.coverage_score, s.evidence_score, s.assessment_score,
    s.coverage_weight, s.evidence_weight, s.assessment_weight,
    s.total_controls, s.implemented_count, s.partial_count, s.planned_count,
    s.alternative_count, s.not_implemented_count, s.not_applicable_count,
    s.fresh_evidence_count, s.stale_evidence_count, s.total_evidence_count,
    s.satisfied_assessment_count, s.partial_assessment_count,
    s.not_satisfied_assessment_count, s.total_assessment_count,
    JSON.stringify(s.family_breakdown), calculatedAt,
  );
}

function insertHistory(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null,
  calculatedAt: string,
  s: ComputedScore,
  trigger: string,
): void {
  db.prepare(`
    INSERT INTO compliance_score_history (
      id, scope_id, catalog_id, overall_score,
      coverage_score, evidence_score, assessment_score,
      family_breakdown, trigger, calculated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateUuid(), scopeId, catalogId, s.overall_score,
    s.coverage_score, s.evidence_score, s.assessment_score,
    JSON.stringify(s.family_breakdown), trigger, calculatedAt,
  );
}

function hydrateScore(row: any): ComplianceScore {
  return {
    id: row.id,
    scope_id: row.scope_id,
    catalog_id: row.catalog_id,
    overall_score: row.overall_score,
    coverage_score: row.coverage_score,
    evidence_score: row.evidence_score,
    assessment_score: row.assessment_score,
    coverage_weight: row.coverage_weight,
    evidence_weight: row.evidence_weight,
    assessment_weight: row.assessment_weight,
    total_controls: row.total_controls,
    implemented_count: row.implemented_count,
    partial_count: row.partial_count,
    planned_count: row.planned_count,
    alternative_count: row.alternative_count,
    not_implemented_count: row.not_implemented_count,
    not_applicable_count: row.not_applicable_count,
    fresh_evidence_count: row.fresh_evidence_count,
    stale_evidence_count: row.stale_evidence_count,
    total_evidence_count: row.total_evidence_count,
    satisfied_assessment_count: row.satisfied_assessment_count,
    partial_assessment_count: row.partial_assessment_count,
    not_satisfied_assessment_count: row.not_satisfied_assessment_count,
    total_assessment_count: row.total_assessment_count,
    family_breakdown: parseJson(row.family_breakdown),
    calculated_at: row.calculated_at,
  };
}

function parseJson(s: string | null | undefined): FamilyBreakdown[] {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

function scopeFilter(scopeId: string | null): string {
  return scopeId === null ? 'scope_id IS NULL' : 'scope_id = ?';
}

function scopeParams(catalogId: string, scopeId: string | null): unknown[] {
  return scopeId === null ? [catalogId] : [catalogId, scopeId];
}
