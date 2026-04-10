-- ============================================================
-- ATTESTING DATABASE SCHEMA
-- ============================================================

-- Organizations using the tool
CREATE TABLE organizations (
    id TEXT PRIMARY KEY,                    -- UUID
    name TEXT NOT NULL,                     -- "Nutanix, Inc."
    description TEXT,
    cage_code TEXT,                         -- DoD CAGE code if applicable
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Product/system scopes within an organization
-- (e.g., "On-Premises Products", "Cloud Services", "NKP")
CREATE TABLE scopes (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,                     -- "On-Premises Products"
    description TEXT,                       -- "Customers running Nutanix in their own data centers"
    scope_type TEXT NOT NULL DEFAULT 'product',  -- 'product', 'system', 'service', 'facility'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- LAYER 1: CONTROL CATALOGS
-- ============================================================

-- A catalog is a collection of controls from a single framework
CREATE TABLE catalogs (
    id TEXT PRIMARY KEY,                    -- UUID
    name TEXT NOT NULL,                     -- "NIST SP 800-171 Rev 2"
    short_name TEXT NOT NULL UNIQUE,        -- "nist-800-171-r2"
    version TEXT,                           -- "Rev 2"
    source_url TEXT,                        -- Where the catalog came from
    source_format TEXT,                     -- 'oscal', 'sig-xlsm', 'csv', 'manual'
    total_controls INTEGER DEFAULT 0,
    description TEXT,
    publisher TEXT,                         -- "NIST", "Shared Assessments", "ISO"
    oscal_uuid TEXT,                        -- Original OSCAL UUID if imported from OSCAL
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual controls within a catalog
CREATE TABLE controls (
    id TEXT PRIMARY KEY,                    -- UUID (internal)
    catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
    control_id TEXT NOT NULL,               -- Framework-native ID: "3.1.1", "A.5.1", "A.1", "AC.L2-3.1.1"
    parent_control_id TEXT,                 -- Self-reference for hierarchical controls (SIG parent/child)
    title TEXT NOT NULL,                    -- Short title
    description TEXT,                       -- Full question/requirement text
    guidance TEXT,                          -- Supplementary guidance or discussion

    -- Framework-specific metadata stored as JSON
    -- SIG: { "risk_domain": "A", "control_family": "Risk Management Principles",
    --        "control_attribute": "Policies, Standards and Procedures",
    --        "scope_level": "Lite", "serial_no": 5643 }
    -- NIST: { "family": "Access Control", "baseline": ["LOW", "MODERATE", "HIGH"] }
    -- ISO: { "clause": "5.1", "category": "Organizational controls" }
    metadata TEXT DEFAULT '{}',             -- JSON blob for framework-specific fields

    -- SIG-specific fields (nullable for non-SIG catalogs)
    sig_risk_domain TEXT,                   -- "A. Enterprise Risk Management"
    sig_control_family TEXT,                -- "Risk Management Principles"
    sig_control_attribute TEXT,             -- "Policies, Standards and Procedures"
    sig_scope_level TEXT,                   -- "Lite", "Core", "Detail"
    sig_serial_no INTEGER,                  -- SIG serial number
    sig_importance TEXT,                    -- From SIG Content Library
    sig_doc_reference TEXT,                 -- Documentation reference

    sort_order INTEGER DEFAULT 0,          -- For maintaining display order
    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(catalog_id, control_id)
);

-- Full-text search on controls
CREATE VIRTUAL TABLE controls_fts USING fts5(
    control_id, title, description, guidance,
    content=controls, content_rowid=rowid
);

-- ============================================================
-- CONTROL PARAMETERS (organization-defined values)
-- ============================================================

CREATE TABLE IF NOT EXISTS control_params (
    id TEXT PRIMARY KEY,
    control_id TEXT NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
    param_id TEXT NOT NULL,                 -- OSCAL param ID: "ac-02_odp.01"
    label TEXT,                             -- Display label: "organization-defined frequency"
    description TEXT,                       -- Guideline prose from OSCAL
    default_value TEXT,                     -- Default/example from OSCAL select choices
    value TEXT,                             -- User-set value: "quarterly"
    set_by TEXT,                            -- Who set it
    set_at TEXT,                            -- When it was set
    UNIQUE(control_id, param_id)
);

CREATE INDEX IF NOT EXISTS idx_params_control ON control_params(control_id);

-- ============================================================
-- LAYER 2: CROSS-FRAMEWORK MAPPINGS
-- ============================================================

-- Mapping between two controls from different catalogs
CREATE TABLE control_mappings (
    id TEXT PRIMARY KEY,
    source_control_id TEXT NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
    target_control_id TEXT NOT NULL REFERENCES controls(id) ON DELETE CASCADE,

    -- Relationship type per OSCAL mapping model
    relationship TEXT NOT NULL DEFAULT 'equivalent',
    -- 'equivalent'   = controls are substantially the same
    -- 'subset'       = source is a subset of target (source is more specific)
    -- 'superset'     = source is a superset of target (source is broader)
    -- 'related'      = controls are related but not equivalent
    -- 'intersects'   = controls partially overlap

    confidence TEXT DEFAULT 'high',         -- 'high', 'medium', 'low'
    notes TEXT,                             -- Explanation of the mapping relationship
    source TEXT DEFAULT 'manual',           -- 'manual', 'sig-content-library', 'nist-published', 'ai-suggested'
    verified_by TEXT,                       -- Who verified this mapping
    verified_at TEXT,                       -- When it was verified

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(source_control_id, target_control_id)
);

-- Index for bidirectional lookups
CREATE INDEX idx_mappings_source ON control_mappings(source_control_id);
CREATE INDEX idx_mappings_target ON control_mappings(target_control_id);

-- ============================================================
-- LAYER 3: IMPLEMENTATION STATEMENTS
-- ============================================================

-- An implementation statement describes HOW an organization satisfies a control
-- One implementation can satisfy multiple controls across frameworks via mappings
CREATE TABLE implementations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    scope_id TEXT REFERENCES scopes(id),    -- Which product/system this applies to (null = org-wide)

    -- The primary control this implementation addresses
    -- (mapped controls are resolved automatically)
    primary_control_id TEXT NOT NULL REFERENCES controls(id),

    -- Implementation details
    status TEXT NOT NULL DEFAULT 'not-implemented',
    -- 'implemented'       = Control is fully in place
    -- 'partially-implemented' = Control exists but has gaps
    -- 'planned'           = Control is planned but not yet in place
    -- 'alternative'       = An alternative control is in place
    -- 'not-applicable'    = Control does not apply to this scope
    -- 'not-implemented'   = Control is not in place

    -- The actual implementation narrative
    statement TEXT NOT NULL,                -- "Nutanix enforces MFA on all privileged accounts using Okta..."

    -- Additional detail
    responsible_role TEXT,                  -- "IT Security", "FSO", "ITPSO"
    responsible_person TEXT,                -- "Roland Williams"

    -- SIG-specific response fields
    sig_response TEXT,                      -- 'Yes', 'No', 'N/A' (for SIG questionnaire export)
    sig_additional_info TEXT,               -- Maps to SIG "Additional Information" column
    sig_scoring TEXT,                       -- Maps to SIG scoring column

    -- Shared responsibility model
    responsibility_type TEXT DEFAULT 'provider',
    -- 'provider'    = Our organization is fully responsible
    -- 'customer'    = Customer is responsible (e.g., physical security for on-prem)
    -- 'shared'      = Shared responsibility
    -- 'inherited'   = Inherited from a third party or CSP

    responsibility_note TEXT,               -- Explanation of shared/customer responsibility boundary

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_impl_org ON implementations(org_id);
CREATE INDEX idx_impl_scope ON implementations(scope_id);
CREATE INDEX idx_impl_control ON implementations(primary_control_id);
CREATE INDEX idx_impl_status ON implementations(status);

-- ============================================================
-- LAYER 4: ASSESSMENT & EVIDENCE
-- ============================================================

-- An assessment is a point-in-time evaluation of controls
CREATE TABLE assessments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    scope_id TEXT REFERENCES scopes(id),
    catalog_id TEXT NOT NULL REFERENCES catalogs(id),  -- Which framework is being assessed

    name TEXT NOT NULL,                     -- "CMMC Level 2 Self-Assessment Q1 2026"
    assessment_type TEXT DEFAULT 'self',    -- 'self', 'third-party', 'audit', 'dcsa-review'
    assessor TEXT,                          -- Who performed the assessment

    started_at TEXT,
    completed_at TEXT,
    status TEXT DEFAULT 'in-progress',      -- 'planned', 'in-progress', 'completed', 'archived'

    -- Summary scores
    total_controls INTEGER DEFAULT 0,
    controls_met INTEGER DEFAULT 0,
    controls_not_met INTEGER DEFAULT 0,
    controls_na INTEGER DEFAULT 0,
    controls_partial INTEGER DEFAULT 0,

    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual control assessment results
CREATE TABLE assessment_results (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    control_id TEXT NOT NULL REFERENCES controls(id),
    implementation_id TEXT REFERENCES implementations(id),

    result TEXT NOT NULL DEFAULT 'not-assessed',
    -- 'satisfied'     = Control requirement is met
    -- 'not-satisfied' = Control requirement is not met
    -- 'partial'       = Partially met
    -- 'not-applicable'= Does not apply
    -- 'not-assessed'  = Not yet evaluated

    finding TEXT,                           -- Description of finding if not satisfied
    risk_level TEXT,                        -- 'critical', 'high', 'medium', 'low'
    assessor_notes TEXT,

    assessed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Evidence linked to implementations or assessment results
CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    implementation_id TEXT REFERENCES implementations(id),
    assessment_result_id TEXT REFERENCES assessment_results(id),

    title TEXT NOT NULL,                    -- "MFA Configuration Screenshot"
    description TEXT,
    evidence_type TEXT DEFAULT 'document',  -- 'document', 'screenshot', 'log', 'policy', 'interview', 'observation'
    file_path TEXT,                         -- Local file path
    file_hash TEXT,                         -- SHA-256 for integrity
    url TEXT,                               -- External URL if applicable

    collected_at TEXT,
    collected_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- POA&M items for tracking remediation
CREATE TABLE poam_items (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    assessment_result_id TEXT REFERENCES assessment_results(id),
    control_id TEXT NOT NULL REFERENCES controls(id),

    poam_id TEXT NOT NULL,                  -- Human-readable ID: "POAM-001"
    priority TEXT NOT NULL DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'

    finding TEXT NOT NULL,                  -- What's wrong
    current_state TEXT,                     -- Where we are now
    required_action TEXT NOT NULL,          -- What needs to happen

    responsible TEXT,                       -- Who owns the fix
    support TEXT,                           -- Who supports

    target_date TEXT,                       -- When it should be done
    actual_completion_date TEXT,

    status TEXT NOT NULL DEFAULT 'not-started',
    -- 'not-started', 'in-progress', 'completed', 'overdue', 'deferred'

    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- GOVERNANCE: Policies, Committees, Roles
-- ============================================================

CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    policy_type TEXT DEFAULT 'policy',
    status TEXT DEFAULT 'draft',
    version TEXT,
    owner TEXT,
    approver TEXT,
    approved_date TEXT,
    effective_date TEXT,
    review_date TEXT,
    expiry_date TEXT,
    review_frequency_days INTEGER DEFAULT 365,
    document_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_controls (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    control_id TEXT NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
    notes TEXT,
    UNIQUE(policy_id, control_id)
);

CREATE TABLE IF NOT EXISTS committees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    meeting_frequency TEXT,
    chair TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS committee_meetings (
    id TEXT PRIMARY KEY,
    committee_id TEXT NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
    meeting_date TEXT NOT NULL,
    attendees TEXT,
    agenda TEXT,
    minutes TEXT,
    action_items TEXT,
    status TEXT DEFAULT 'scheduled',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles_register (
    id TEXT PRIMARY KEY,
    role_title TEXT NOT NULL,
    description TEXT,
    current_holder TEXT,
    appointed_date TEXT,
    appointment_authority TEXT,
    backup_holder TEXT,
    regulatory_requirement TEXT,
    replacement_timeline TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- RISK MANAGEMENT: Register, Matrix, Exceptions
-- ============================================================

CREATE TABLE IF NOT EXISTS risk_matrix (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Default',
    likelihood_levels TEXT NOT NULL DEFAULT '["Rare","Unlikely","Possible","Likely","Almost Certain"]',
    impact_levels TEXT NOT NULL DEFAULT '["Negligible","Minor","Moderate","Major","Critical"]',
    risk_appetite TEXT DEFAULT 'moderate',
    appetite_threshold INTEGER DEFAULT 9,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risks (
    id TEXT PRIMARY KEY,
    risk_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    source TEXT,
    likelihood INTEGER NOT NULL,
    impact INTEGER NOT NULL,
    inherent_risk_score INTEGER,
    residual_likelihood INTEGER,
    residual_impact INTEGER,
    residual_risk_score INTEGER,
    treatment TEXT DEFAULT 'mitigate',
    treatment_plan TEXT,
    owner TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    review_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_controls (
    id TEXT PRIMARY KEY,
    risk_id TEXT NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
    control_id TEXT NOT NULL REFERENCES controls(id) ON DELETE CASCADE,
    effectiveness TEXT DEFAULT 'partial',
    notes TEXT,
    UNIQUE(risk_id, control_id)
);

CREATE TABLE IF NOT EXISTS risk_exceptions (
    id TEXT PRIMARY KEY,
    risk_id TEXT NOT NULL REFERENCES risks(id),
    control_id TEXT REFERENCES controls(id),
    justification TEXT NOT NULL,
    compensating_controls TEXT,
    approved_by TEXT NOT NULL,
    approved_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- CATALOG WATCH LIST (upstream source monitoring)
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog_watches (
    id TEXT PRIMARY KEY,
    catalog_short_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_format TEXT NOT NULL DEFAULT 'oscal',
    -- 'oscal', 'csv', 'sig-xlsm'
    last_hash TEXT,
    last_checked_at TEXT,
    last_changed_at TEXT,
    auto_download INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================

-- Resolve all mapped controls for a given control
CREATE VIEW v_control_mappings AS
SELECT
    c1.id AS source_id,
    c1.control_id AS source_control_id,
    cat1.short_name AS source_catalog,
    c2.id AS target_id,
    c2.control_id AS target_control_id,
    cat2.short_name AS target_catalog,
    cm.relationship,
    cm.confidence
FROM control_mappings cm
JOIN controls c1 ON cm.source_control_id = c1.id
JOIN controls c2 ON cm.target_control_id = c2.id
JOIN catalogs cat1 ON c1.catalog_id = cat1.id
JOIN catalogs cat2 ON c2.catalog_id = cat2.id;

-- Implementation coverage across all frameworks for a scope
CREATE VIEW v_implementation_coverage AS
SELECT
    cat.short_name AS catalog,
    cat.name AS catalog_name,
    s.name AS scope_name,
    COUNT(DISTINCT c.id) AS total_controls,
    COUNT(DISTINCT CASE WHEN i.status = 'implemented' THEN c.id END) AS implemented,
    COUNT(DISTINCT CASE WHEN i.status = 'partially-implemented' THEN c.id END) AS partial,
    COUNT(DISTINCT CASE WHEN i.status = 'not-applicable' THEN c.id END) AS not_applicable,
    COUNT(DISTINCT CASE WHEN i.status = 'not-implemented' OR i.id IS NULL THEN c.id END) AS not_implemented,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN i.status IN ('implemented', 'not-applicable') THEN c.id END) / COUNT(DISTINCT c.id), 1) AS coverage_pct
FROM controls c
JOIN catalogs cat ON c.catalog_id = cat.id
LEFT JOIN implementations i ON i.primary_control_id = c.id
LEFT JOIN scopes s ON i.scope_id = s.id
GROUP BY cat.short_name, cat.name, s.name;

-- SIG questionnaire view: resolves implementations to SIG responses
CREATE VIEW v_sig_responses AS
SELECT
    c.sig_serial_no,
    c.control_id AS sig_question_number,
    c.description AS question_text,
    c.sig_risk_domain,
    c.sig_control_family,
    c.sig_control_attribute,
    c.sig_scope_level,
    c.sig_importance,
    c.sig_doc_reference,
    i.sig_response,
    i.statement AS additional_information,
    i.sig_additional_info,
    i.sig_scoring,
    i.status AS implementation_status,
    i.responsibility_type,
    i.responsibility_note,
    s.name AS scope_name
FROM controls c
JOIN catalogs cat ON c.catalog_id = cat.id AND cat.short_name LIKE 'sig-%'
LEFT JOIN implementations i ON i.primary_control_id = c.id
LEFT JOIN scopes s ON i.scope_id = s.id
ORDER BY c.sort_order;
