-- Phase 8D: Continuous monitoring thresholds.
--
-- Stores configurable score thresholds per scope+catalog for the posture
-- monitor. Rows with NULL scope_id/catalog_id act as global defaults.
-- If no row matches, the monitor falls back to built-in defaults defined
-- in src/services/monitoring/thresholds.ts.

CREATE TABLE IF NOT EXISTS monitoring_thresholds (
    id TEXT PRIMARY KEY,
    scope_id TEXT REFERENCES scopes(id) ON DELETE CASCADE,
    catalog_id TEXT REFERENCES catalogs(id) ON DELETE CASCADE,

    -- Absolute score thresholds (0..100)
    warning_threshold REAL NOT NULL DEFAULT 80,
    critical_threshold REAL NOT NULL DEFAULT 60,

    -- Delta thresholds: score decrease between two consecutive snapshots
    -- that trigger an alert. Expressed as positive numbers.
    delta_warning REAL NOT NULL DEFAULT 5,
    delta_critical REAL NOT NULL DEFAULT 10,

    -- Trend window: number of consecutive snapshots checked for sustained
    -- decline. 3 means "alert if score dropped in each of the last 3 snapshots".
    trend_window INTEGER NOT NULL DEFAULT 3,

    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitoring_thresholds_lookup
    ON monitoring_thresholds(scope_id, catalog_id);
