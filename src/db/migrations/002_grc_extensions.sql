-- ============================================================
-- ATTESTING MIGRATION 002: GRC EXTENSIONS
-- Extends existing governance/risk tables with new columns,
-- adds threat intel, assets, drift, disposition, connector,
-- and audit tables. Does NOT recreate existing tables.
-- ============================================================

-- ─── OWNERS (new) ────────────────────────────────────────────
-- Typed entity for people, replaces free-text owner fields.
-- Existing text owner fields remain for backward compat;
-- new FKs point here.
CREATE TABLE IF NOT EXISTS owners (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT,
    role            TEXT,
    department      TEXT,
    clearance_level TEXT,
    is_supervisor   INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── EXTEND policies ────────────────────────────────────────
-- Add content_hash for drift detection, owner FK, supersession
ALTER TABLE policies ADD COLUMN content_hash TEXT;
ALTER TABLE policies ADD COLUMN short_name TEXT;
ALTER TABLE policies ADD COLUMN owner_id TEXT REFERENCES owners(id);
ALTER TABLE policies ADD COLUMN supersedes_id TEXT REFERENCES policies(id);
ALTER TABLE policies ADD COLUMN next_review_date TEXT;

-- ─── POLICY SECTIONS (new) ──────────────────────────────────
-- Granular sections within a policy for per-section drift tracking
CREATE TABLE IF NOT EXISTS policy_sections (
    id              TEXT PRIMARY KEY,
    policy_id       TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    section_number  TEXT NOT NULL,
    title           TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    version         TEXT NOT NULL,
    summary         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(policy_id, section_number)
);

-- ─── EXTEND risks ───────────────────────────────────────────
-- Add owner FK, source traceability
ALTER TABLE risks ADD COLUMN owner_id TEXT REFERENCES owners(id);
ALTER TABLE risks ADD COLUMN source_type TEXT;
ALTER TABLE risks ADD COLUMN source_id TEXT;

-- ─── ASSET INVENTORY (new) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_boundaries (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    boundary_type TEXT DEFAULT 'network'
                  CHECK (boundary_type IN ('network','physical','logical','cloud','hybrid')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    asset_type          TEXT NOT NULL CHECK (asset_type IN (
                        'server','endpoint','application','database',
                        'network_device','cloud_service','data_store',
                        'iot','virtual','other')),
    platform            TEXT,
    os_version          TEXT,
    data_classification TEXT DEFAULT 'unclassified' CHECK (data_classification IN (
                        'unclassified','cui','confidential','secret','top_secret')),
    boundary_id         TEXT REFERENCES asset_boundaries(id),
    owner_id            TEXT REFERENCES owners(id),
    criticality         TEXT DEFAULT 'medium' CHECK (criticality IN ('low','medium','high','critical')),
    status              TEXT DEFAULT 'active' CHECK (status IN ('active','decommissioned','planned','maintenance')),
    external_id         TEXT,
    external_source     TEXT,
    metadata            TEXT,
    last_scanned        TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assets_platform ON assets(platform);
CREATE INDEX IF NOT EXISTS idx_assets_external ON assets(external_source, external_id);

-- ─── RISK ↔ ASSET junction (new) ────────────────────────────
CREATE TABLE IF NOT EXISTS risk_asset_links (
    risk_id  TEXT NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    PRIMARY KEY (risk_id, asset_id)
);

-- ─── THREAT INTELLIGENCE (new) ──────────────────────────────
CREATE TABLE IF NOT EXISTS threat_inputs (
    id                TEXT PRIMARY KEY,
    channel           TEXT NOT NULL CHECK (channel IN (
                      'stix_taxii','cisa_kev','nvd','isac',
                      'vendor_advisory','manual','osint','internal')),
    threat_type       TEXT NOT NULL CHECK (threat_type IN (
                      'vulnerability','exploit','campaign','malware',
                      'ttp','advisory','regulatory','best_practice')),
    title             TEXT NOT NULL,
    description       TEXT,
    severity          TEXT DEFAULT 'medium' CHECK (severity IN (
                      'info','low','medium','high','critical')),
    cvss_score        REAL,
    cve_id            TEXT,
    source_ref        TEXT,
    source_name       TEXT,
    affected_platforms TEXT,
    affected_products  TEXT,
    ttps              TEXT,
    iocs              TEXT,
    is_corroborated   INTEGER DEFAULT 1,
    corroborated_at   TEXT,
    corroborated_by   TEXT,
    ingested_at       TEXT DEFAULT (datetime('now')),
    processed         INTEGER DEFAULT 0,
    processed_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threats_severity ON threat_inputs(severity);
CREATE INDEX IF NOT EXISTS idx_threats_processed ON threat_inputs(processed);

CREATE TABLE IF NOT EXISTS threat_risk_links (
    threat_id TEXT NOT NULL REFERENCES threat_inputs(id) ON DELETE CASCADE,
    risk_id   TEXT NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
    PRIMARY KEY (threat_id, risk_id)
);

CREATE TABLE IF NOT EXISTS threat_asset_correlations (
    threat_id     TEXT NOT NULL REFERENCES threat_inputs(id) ON DELETE CASCADE,
    asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    match_type    TEXT DEFAULT 'platform' CHECK (match_type IN (
                  'platform','product','version','manual','cpe')),
    match_detail  TEXT,
    correlated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (threat_id, asset_id)
);

-- ─── MANUAL INTELLIGENCE / whisper channel (new) ────────────
CREATE TABLE IF NOT EXISTS manual_intel (
    id                     TEXT PRIMARY KEY,
    title                  TEXT NOT NULL,
    description            TEXT NOT NULL,
    source_description     TEXT,
    submitted_by           TEXT REFERENCES owners(id),
    confidence_level       TEXT DEFAULT 'unverified' CHECK (confidence_level IN (
                           'unverified','low','medium','high','confirmed')),
    intel_type             TEXT DEFAULT 'threat' CHECK (intel_type IN (
                           'threat','vulnerability','regulatory','operational','best_practice')),
    severity_estimate      TEXT DEFAULT 'medium' CHECK (severity_estimate IN (
                           'info','low','medium','high','critical')),
    affected_platforms_est TEXT,
    affected_controls_est  TEXT,
    shadow_impact_snapshot TEXT,
    shadow_generated_at    TEXT,
    corroboration_deadline TEXT,
    corroboration_sources  TEXT,
    promoted_to_threat_id  TEXT REFERENCES threat_inputs(id),
    promoted_at            TEXT,
    archived_at            TEXT,
    archive_reason         TEXT,
    status                 TEXT DEFAULT 'provisional' CHECK (status IN (
                           'provisional','watching','promoted','archived')),
    created_at             TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_manual_intel_status ON manual_intel(status);

-- ─── DRIFT ALERTS (new) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS drift_alerts (
    id                 TEXT PRIMARY KEY,
    alert_type         TEXT NOT NULL CHECK (alert_type IN (
                       'policy_stale','evidence_expired','control_gap',
                       'framework_update','asset_drift','risk_threshold',
                       'training_overdue','review_overdue','connector_failure',
                       'manual_intel_expiring','disposition_expiring','posture_change')),
    severity           TEXT DEFAULT 'medium' CHECK (severity IN (
                       'info','low','medium','high','critical')),
    title              TEXT NOT NULL,
    message            TEXT,
    source_entity_type TEXT NOT NULL,
    source_entity_id   TEXT NOT NULL,
    affected_entities  TEXT,
    detected_at        TEXT DEFAULT (datetime('now')),
    acknowledged_at    TEXT,
    acknowledged_by    TEXT REFERENCES owners(id),
    resolved_at        TEXT,
    resolved_by        TEXT,
    auto_resolved      INTEGER DEFAULT 0,
    resolution_note    TEXT,
    disposition_id     TEXT,
    suppressed_until   TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_drift_unresolved ON drift_alerts(resolved_at)
    WHERE resolved_at IS NULL;

-- ─── DISPOSITIONS (new) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispositions (
    id                      TEXT PRIMARY KEY,
    drift_alert_id          TEXT NOT NULL REFERENCES drift_alerts(id),
    disposition_type        TEXT NOT NULL CHECK (disposition_type IN (
                            'accepted_risk','by_design','compensating_control',
                            'deferred','false_positive','not_applicable')),
    analyst_id              TEXT NOT NULL REFERENCES owners(id),
    rationale               TEXT NOT NULL,
    rationale_parsed        TEXT,
    linked_entities         TEXT,
    compensating_impl_id    TEXT REFERENCES implementations(id),
    deferral_target_date    TEXT,
    requires_approval       INTEGER DEFAULT 1,
    approval_status         TEXT DEFAULT 'pending' CHECK (approval_status IN (
                            'pending','approved','rejected','escalated','expired')),
    supervisor_id           TEXT REFERENCES owners(id),
    supervisor_note         TEXT,
    approved_at             TEXT,
    expires_at              TEXT,
    auto_tasks_created      TEXT,
    nlp_confidence          REAL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_disp_approval ON dispositions(approval_status);

CREATE TABLE IF NOT EXISTS disposition_tasks (
    id                  TEXT PRIMARY KEY,
    disposition_id      TEXT NOT NULL REFERENCES dispositions(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT,
    assigned_to         TEXT REFERENCES owners(id),
    target_entity_type  TEXT,
    target_entity_id    TEXT,
    due_date            TEXT,
    status              TEXT DEFAULT 'open' CHECK (status IN (
                        'open','in_progress','completed','cancelled')),
    completed_at        TEXT,
    external_ticket_id  TEXT,
    external_ticket_url TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── INTEGRATION CONNECTORS (new) ───────────────────────────
CREATE TABLE IF NOT EXISTS connectors (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    connector_type   TEXT NOT NULL CHECK (connector_type IN (
                     'threat_feed','asset_inventory','siem','ticketing',
                     'identity','sbom','vulnerability_scanner','cloud_provider',
                     'compliance_tool','communication','custom')),
    direction        TEXT NOT NULL CHECK (direction IN (
                     'inbound','outbound','bidirectional')),
    target_module    TEXT NOT NULL CHECK (target_module IN (
                     'risk','asset','compliance','governance','evidence','multi')),
    adapter_class    TEXT NOT NULL,
    config           TEXT,
    auth_method      TEXT CHECK (auth_method IN (
                     'api_key','oauth2','basic','certificate','webhook','none')),
    sync_mode        TEXT DEFAULT 'scheduled' CHECK (sync_mode IN (
                     'scheduled','webhook','manual','event_driven')),
    sync_interval    INTEGER,
    last_sync_at     TEXT,
    last_sync_status TEXT DEFAULT 'never' CHECK (last_sync_status IN (
                     'never','success','partial','failed','syncing')),
    last_sync_error  TEXT,
    last_sync_stats  TEXT,
    is_enabled       INTEGER DEFAULT 1,
    health_status    TEXT DEFAULT 'unknown' CHECK (health_status IN (
                     'healthy','degraded','unhealthy','unknown')),
    health_checked_at TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connector_sync_log (
    id                TEXT PRIMARY KEY,
    connector_id      TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    started_at        TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at      TEXT,
    status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                      'running','success','partial','failed','cancelled')),
    records_processed INTEGER DEFAULT 0,
    records_created   INTEGER DEFAULT 0,
    records_updated   INTEGER DEFAULT 0,
    records_deleted   INTEGER DEFAULT 0,
    errors            INTEGER DEFAULT 0,
    error_details     TEXT,
    sync_type         TEXT DEFAULT 'full' CHECK (sync_type IN (
                      'full','incremental','delta','manual')),
    trigger           TEXT DEFAULT 'scheduled' CHECK (trigger IN (
                      'scheduled','webhook','manual','event'))
);

-- ─── AUDIT LOG (new) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    action          TEXT NOT NULL CHECK (action IN (
                    'create','update','delete','approve','reject','promote',
                    'archive','suppress','resolve','escalate','sync',
                    'correlate','propagate')),
    actor_type      TEXT DEFAULT 'user' CHECK (actor_type IN (
                    'user','system','connector','nlp')),
    actor_id        TEXT,
    previous_state  TEXT,
    new_state       TEXT,
    change_summary  TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);
