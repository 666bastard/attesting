-- Phase 8E: Evidence lifecycle columns.
--
-- Extends the existing `evidence` table with a state machine, reviewer
-- metadata, validity window, renewal tracking, and version chaining so
-- auditors can trace provenance and expiry.
--
-- SQLite's ALTER TABLE ADD COLUMN is not idempotent, so the test-db
-- helper wraps each migration in a try/catch to tolerate "duplicate
-- column" errors on re-runs.
--
-- States:
--   draft → submitted → reviewed → accepted → expiring → expired → archived
--                              ↓
--                           rejected → draft
--
-- `valid_from` / `valid_until` define the active validity window. The
-- scheduler transitions `accepted → expiring` when valid_until is within
-- the renewal lead time, and `expiring → expired` when valid_until passes.

ALTER TABLE evidence ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE evidence ADD COLUMN reviewer_id TEXT;
ALTER TABLE evidence ADD COLUMN reviewed_at TEXT;
ALTER TABLE evidence ADD COLUMN review_notes TEXT;
ALTER TABLE evidence ADD COLUMN valid_from TEXT;
ALTER TABLE evidence ADD COLUMN valid_until TEXT;
ALTER TABLE evidence ADD COLUMN renewal_period_days INTEGER;
ALTER TABLE evidence ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE evidence ADD COLUMN previous_version_id TEXT;
ALTER TABLE evidence ADD COLUMN last_state_change_at TEXT;
ALTER TABLE evidence ADD COLUMN state_changed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence(status);
CREATE INDEX IF NOT EXISTS idx_evidence_valid_until ON evidence(valid_until);
CREATE INDEX IF NOT EXISTS idx_evidence_previous_version ON evidence(previous_version_id);

-- Audit trail: one row per transition for full lifecycle history.
CREATE TABLE IF NOT EXISTS evidence_state_history (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    reviewer_id TEXT,
    notes TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_history_evidence
    ON evidence_state_history(evidence_id, changed_at DESC);
