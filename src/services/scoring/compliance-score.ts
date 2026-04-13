import type Database from 'better-sqlite3';
import {
  DEFAULT_WEIGHTS,
  EVIDENCE_FRESH_DAYS,
  type ComplianceScore,
  type FamilyBreakdown,
  type ScoringWeights,
} from '../../models/compliance-score.js';

/**
 * Stateless compliance score calculator.
 *
 * Phase 8A — implements the three-factor formula from docs/roadmap/compliance-scoring.md:
 *
 *   score = coverage × 0.5 + evidence × 0.3 + assessment × 0.2
 *
 * Sub-scores are 0..100. Controls marked `not-applicable` are excluded from
 * every denominator. A sub-score is null when its sample size is zero, and
 * the composite renormalizes the remaining weights so you don't tank the
 * overall score just because you haven't run an assessment yet.
 *
 * Control status weights (for coverage sub-score):
 *   implemented          1.00
 *   alternative          0.75
 *   partially-implemented 0.50
 *   planned              0.25
 *   not-implemented      0.00
 *   not-applicable       excluded
 */

// ── Status → weight mapping ────────────────────────────────

const STATUS_WEIGHT: Record<string, number> = {
  'implemented': 1.0,
  'alternative': 0.75,
  'partially-implemented': 0.5,
  'planned': 0.25,
  'not-implemented': 0.0,
};

interface ControlRow {
  id: string;
  family: string;
  status: string | null;
}

interface EvidenceRow {
  id: string;
  collected_at: string | null;
  created_at: string;
}

interface AssessmentResultRow {
  result: string;
}

// ── Public API ─────────────────────────────────────────────

export type ComputedScore = Omit<ComplianceScore, 'id' | 'calculated_at'>;

/**
 * Compute a compliance score for a (catalog, scope?) pair without persisting.
 * Returns the full shape including sub-scores and per-family breakdown.
 */
export function calculateScore(
  db: Database.Database,
  catalogId: string,
  scopeId: string | null = null,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ComputedScore {
  const controls = loadControls(db, catalogId, scopeId);
  const coverage = computeCoverage(controls);
  const evidence = computeEvidence(db, catalogId, scopeId);
  const assessment = computeAssessment(db, catalogId, scopeId);
  const families = computeFamilies(controls);

  const { overall, coverageWeight, evidenceWeight, assessmentWeight } =
    composeOverall(coverage.score, evidence.score, assessment.score, weights);

  return {
    scope_id: scopeId,
    catalog_id: catalogId,
    overall_score: round2(overall),
    coverage_score: coverage.score === null ? null : round2(coverage.score),
    evidence_score: evidence.score === null ? null : round2(evidence.score),
    assessment_score: assessment.score === null ? null : round2(assessment.score),
    coverage_weight: coverageWeight,
    evidence_weight: evidenceWeight,
    assessment_weight: assessmentWeight,
    total_controls: coverage.total,
    implemented_count: coverage.byStatus.implemented,
    partial_count: coverage.byStatus.partial,
    planned_count: coverage.byStatus.planned,
    alternative_count: coverage.byStatus.alternative,
    not_implemented_count: coverage.byStatus.notImplemented,
    not_applicable_count: coverage.byStatus.notApplicable,
    fresh_evidence_count: evidence.fresh,
    stale_evidence_count: evidence.stale,
    total_evidence_count: evidence.total,
    satisfied_assessment_count: assessment.satisfied,
    partial_assessment_count: assessment.partial,
    not_satisfied_assessment_count: assessment.notSatisfied,
    total_assessment_count: assessment.total,
    family_breakdown: families,
  };
}

// ── Coverage sub-score ─────────────────────────────────────

function loadControls(db: Database.Database, catalogId: string, scopeId: string | null): ControlRow[] {
  // One row per control. When a control has multiple implementations (e.g.
  // one per scope, or legacy duplicates), pick the "best" status via the
  // priority list below so counts aren't double-weighted by the LEFT JOIN.
  //
  // Param order: scope_id (optional, in inner subquery) then catalog_id.
  const scopeClause = scopeId
    ? `AND (i2.scope_id = ? OR i2.scope_id IS NULL)`
    : '';
  const params: unknown[] = [];
  if (scopeId) params.push(scopeId);
  params.push(catalogId);

  return db.prepare(`
    SELECT c.id,
           COALESCE(c.family, SUBSTR(c.control_id, 1, 2)) AS family,
           (
             SELECT i2.status
             FROM implementations i2
             WHERE i2.primary_control_id = c.id ${scopeClause}
             ORDER BY
               CASE i2.status
                 WHEN 'implemented'           THEN 1
                 WHEN 'alternative'           THEN 2
                 WHEN 'partially-implemented' THEN 3
                 WHEN 'planned'               THEN 4
                 WHEN 'not-applicable'        THEN 5
                 ELSE 6
               END
             LIMIT 1
           ) AS status
    FROM controls c
    WHERE c.catalog_id = ?
    ORDER BY family, c.sort_order
  `).all(...params) as ControlRow[];
}

function computeCoverage(controls: ControlRow[]) {
  const byStatus = {
    implemented: 0, partial: 0, planned: 0, alternative: 0,
    notImplemented: 0, notApplicable: 0,
  };

  let weighted = 0;
  let denom = 0;

  for (const c of controls) {
    const status = c.status ?? 'not-implemented';
    bumpStatus(byStatus, status);
    if (status === 'not-applicable') continue;
    denom++;
    weighted += STATUS_WEIGHT[status] ?? 0;
  }

  return {
    total: controls.length,
    byStatus,
    score: denom > 0 ? (weighted / denom) * 100 : null,
  };
}

function bumpStatus(byStatus: ReturnType<typeof computeCoverage>['byStatus'], status: string): void {
  switch (status) {
    case 'implemented': byStatus.implemented++; break;
    case 'partially-implemented': byStatus.partial++; break;
    case 'planned': byStatus.planned++; break;
    case 'alternative': byStatus.alternative++; break;
    case 'not-applicable': byStatus.notApplicable++; break;
    default: byStatus.notImplemented++; break;
  }
}

// ── Evidence sub-score ─────────────────────────────────────

function computeEvidence(db: Database.Database, catalogId: string, scopeId: string | null) {
  const scopeClause = scopeId
    ? `AND (i.scope_id = ? OR i.scope_id IS NULL)`
    : '';
  const params: unknown[] = [catalogId];
  if (scopeId) params.push(scopeId);

  const rows = db.prepare(`
    SELECT e.id, e.collected_at, e.created_at
    FROM evidence e
    JOIN implementations i ON e.implementation_id = i.id
    JOIN controls c ON i.primary_control_id = c.id
    WHERE c.catalog_id = ?
      AND (i.status IS NULL OR i.status != 'not-applicable')
      ${scopeClause}
  `).all(...params) as EvidenceRow[];

  const cutoff = Date.now() - EVIDENCE_FRESH_DAYS * 24 * 60 * 60 * 1000;
  let fresh = 0;
  for (const r of rows) {
    const stamp = r.collected_at ?? r.created_at;
    if (stamp && new Date(stamp).getTime() >= cutoff) fresh++;
  }

  const total = rows.length;
  return {
    total,
    fresh,
    stale: total - fresh,
    score: total > 0 ? (fresh / total) * 100 : null,
  };
}

// ── Assessment sub-score ───────────────────────────────────

function computeAssessment(db: Database.Database, catalogId: string, scopeId: string | null) {
  const scopeClause = scopeId ? `AND (a.scope_id = ? OR a.scope_id IS NULL)` : '';
  const params: unknown[] = [catalogId];
  if (scopeId) params.push(scopeId);

  const rows = db.prepare(`
    SELECT ar.result
    FROM assessment_results ar
    JOIN assessments a ON ar.assessment_id = a.id
    WHERE a.catalog_id = ?
      ${scopeClause}
  `).all(...params) as AssessmentResultRow[];

  let satisfied = 0, partial = 0, notSatisfied = 0, na = 0;
  for (const r of rows) {
    switch (r.result) {
      case 'satisfied': satisfied++; break;
      case 'partial': partial++; break;
      case 'not-satisfied': notSatisfied++; break;
      case 'not-applicable': na++; break;
    }
  }

  const denom = satisfied + partial + notSatisfied;
  const weighted = satisfied + partial * 0.5;

  return {
    total: rows.length,
    satisfied,
    partial,
    notSatisfied,
    na,
    score: denom > 0 ? (weighted / denom) * 100 : null,
  };
}

// ── Family breakdown ───────────────────────────────────────

function computeFamilies(controls: ControlRow[]): FamilyBreakdown[] {
  const map = new Map<string, FamilyBreakdown & { _weighted: number; _denom: number }>();

  for (const c of controls) {
    const key = c.family || 'Uncategorized';
    let f = map.get(key);
    if (!f) {
      f = {
        family: key, total: 0, implemented: 0, partial: 0,
        not_applicable: 0, score: 0, _weighted: 0, _denom: 0,
      };
      map.set(key, f);
    }
    f.total++;
    const status = c.status ?? 'not-implemented';
    if (status === 'implemented') f.implemented++;
    if (status === 'partially-implemented') f.partial++;
    if (status === 'not-applicable') { f.not_applicable++; continue; }
    f._denom++;
    f._weighted += STATUS_WEIGHT[status] ?? 0;
  }

  const out: FamilyBreakdown[] = [];
  for (const f of map.values()) {
    const score = f._denom > 0 ? round2((f._weighted / f._denom) * 100) : 0;
    out.push({
      family: f.family, total: f.total, implemented: f.implemented,
      partial: f.partial, not_applicable: f.not_applicable, score,
    });
  }
  out.sort((a, b) => a.family.localeCompare(b.family));
  return out;
}

// ── Weighted composition ───────────────────────────────────

/**
 * Compose the overall score from three sub-scores with renormalization.
 * Any sub-score that is null drops out and its weight is redistributed.
 */
function composeOverall(
  coverage: number | null,
  evidence: number | null,
  assessment: number | null,
  weights: ScoringWeights,
): { overall: number; coverageWeight: number; evidenceWeight: number; assessmentWeight: number } {
  const parts: Array<{ score: number; weight: number; key: 'coverage' | 'evidence' | 'assessment' }> = [];
  if (coverage !== null) parts.push({ score: coverage, weight: weights.coverage, key: 'coverage' });
  if (evidence !== null) parts.push({ score: evidence, weight: weights.evidence, key: 'evidence' });
  if (assessment !== null) parts.push({ score: assessment, weight: weights.assessment, key: 'assessment' });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) {
    return { overall: 0, coverageWeight: 0, evidenceWeight: 0, assessmentWeight: 0 };
  }

  let overall = 0;
  const applied: Record<string, number> = { coverage: 0, evidence: 0, assessment: 0 };
  for (const p of parts) {
    const norm = p.weight / totalWeight;
    applied[p.key] = round4(norm);
    overall += p.score * norm;
  }

  return {
    overall,
    coverageWeight: applied.coverage,
    evidenceWeight: applied.evidence,
    assessmentWeight: applied.assessment,
  };
}

// ── utils ──────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10_000) / 10_000; }
