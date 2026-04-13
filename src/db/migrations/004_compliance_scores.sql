-- Phase 8A: Compliance scoring tables.
--
-- `compliance_scores` holds the latest score snapshot per (scope_id, catalog_id).
-- `compliance_score_history` accumulates every calculation for trend analysis.
--
-- scope_id is nullable (NULL = org-wide). SQLite treats multiple NULLs as distinct
-- under UNIQUE, so snapshot uniqueness is enforced in application code via
-- delete-then-insert inside a transaction.

CREATE TABLE IF NOT EXISTS compliance_scores (
    id TEXT PRIMARY KEY,
    scope_id TEXT REFERENCES scopes(id),
    catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,

    -- Composite score (0..100)
    overall_score REAL NOT NULL,

    -- Sub-scores (0..100, nullable when sample size is zero)
    coverage_score REAL,
    evidence_score REAL,
    assessment_score REAL,

    -- Weights actually applied (renormalized when a sub-score is null)
    coverage_weight REAL NOT NULL,
    evidence_weight REAL NOT NULL,
    assessment_weight REAL NOT NULL,

    -- Coverage tallies
    total_controls INTEGER NOT NULL DEFAULT 0,
    implemented_count INTEGER NOT NULL DEFAULT 0,
    partial_count INTEGER NOT NULL DEFAULT 0,
    planned_count INTEGER NOT NULL DEFAULT 0,
    alternative_count INTEGER NOT NULL DEFAULT 0,
    not_implemented_count INTEGER NOT NULL DEFAULT 0,
    not_applicable_count INTEGER NOT NULL DEFAULT 0,

    -- Evidence tallies
    fresh_evidence_count INTEGER NOT NULL DEFAULT 0,
    stale_evidence_count INTEGER NOT NULL DEFAULT 0,
    total_evidence_count INTEGER NOT NULL DEFAULT 0,

    -- Assessment tallies
    satisfied_assessment_count INTEGER NOT NULL DEFAULT 0,
    partial_assessment_count INTEGER NOT NULL DEFAULT 0,
    not_satisfied_assessment_count INTEGER NOT NULL DEFAULT 0,
    total_assessment_count INTEGER NOT NULL DEFAULT 0,

    -- Per-family breakdown (JSON array of { family, total, implemented, score, ... })
    family_breakdown TEXT NOT NULL DEFAULT '[]',

    calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_scores_catalog
    ON compliance_scores(catalog_id);
CREATE INDEX IF NOT EXISTS idx_compliance_scores_scope
    ON compliance_scores(scope_id);

CREATE TABLE IF NOT EXISTS compliance_score_history (
    id TEXT PRIMARY KEY,
    scope_id TEXT REFERENCES scopes(id),
    catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
    overall_score REAL NOT NULL,
    coverage_score REAL,
    evidence_score REAL,
    assessment_score REAL,
    family_breakdown TEXT NOT NULL DEFAULT '[]',
    trigger TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'propagate' | 'scheduled'
    calculated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_score_history_lookup
    ON compliance_score_history(scope_id, catalog_id, calculated_at DESC);
