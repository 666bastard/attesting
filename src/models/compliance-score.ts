/**
 * Compliance score snapshot and history row shapes.
 * Phase 8A — see docs/roadmap/compliance-scoring.md.
 */

export interface FamilyBreakdown {
  family: string;
  total: number;
  implemented: number;
  partial: number;
  not_applicable: number;
  score: number;        // 0..100 (coverage-only score for this family)
}

export interface ComplianceScore {
  id: string;
  scope_id: string | null;
  catalog_id: string;

  overall_score: number;
  coverage_score: number | null;
  evidence_score: number | null;
  assessment_score: number | null;

  coverage_weight: number;
  evidence_weight: number;
  assessment_weight: number;

  total_controls: number;
  implemented_count: number;
  partial_count: number;
  planned_count: number;
  alternative_count: number;
  not_implemented_count: number;
  not_applicable_count: number;

  fresh_evidence_count: number;
  stale_evidence_count: number;
  total_evidence_count: number;

  satisfied_assessment_count: number;
  partial_assessment_count: number;
  not_satisfied_assessment_count: number;
  total_assessment_count: number;

  family_breakdown: FamilyBreakdown[];
  calculated_at: string;
}

export interface ComplianceScoreHistoryEntry {
  id: string;
  scope_id: string | null;
  catalog_id: string;
  overall_score: number;
  coverage_score: number | null;
  evidence_score: number | null;
  assessment_score: number | null;
  family_breakdown: FamilyBreakdown[];
  trigger: string;
  calculated_at: string;
}

export interface ScoringWeights {
  coverage: number;
  evidence: number;
  assessment: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  coverage: 0.5,
  evidence: 0.3,
  assessment: 0.2,
};

/** Evidence is considered fresh if collected within this many days. */
export const EVIDENCE_FRESH_DAYS = 365;
