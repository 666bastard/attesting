# ATTESTING — OSCAL-Native Compliance Control Platform

## Project Overview

Build a local-first CLI + web application called **Attesting** that replaces spreadsheet-based compliance workflows (SIG Manager, manual SOA attestings, Excel-based gap assessments) with an OSCAL-native data model. The tool lets any organization:

1. Import control catalogs from any framework (NIST 800-171, ISO 27001, SIG, CMMC, NISPOM, custom)
2. Define cross-framework control mappings (SIG question A.1 ↔ ISO 27001 A.5.1 ↔ NIST 800-171 3.1.1)
3. Write implementation statements once and have them resolve across all mapped frameworks
4. Generate output in any format: SIG-compatible .xlsm questionnaires, ISO 27001 SOA workbooks, CMMC self-assessments, OSCAL JSON/XML, or PDF reports
5. Track assessment status, evidence, and remediation (POA&M) per control

The first proof-of-concept use case is generating a SIG Lite Response SIG (135 questions, 21 risk domains) for an on-premises product deployment, cross-referenced against ISO 27001 and NIST 800-171. But the architecture must be fully general — any organization, any set of frameworks, any product/system scope.

---

## Technical Architecture

### Tech Stack

- **Runtime:** Node.js 20+ (TypeScript)
- **Database:** SQLite via better-sqlite3 (local-first, single file, no server dependencies)
- **CLI Framework:** Commander.js
- **Web UI:** React 18 + Vite dev server (optional — CLI is the primary interface, web UI is Phase 2)
- **Export Libraries:**
  - `exceljs` for .xlsx/.xlsm generation (NOT openpyxl — this is a Node project)
  - `pdfkit` for PDF report generation
  - Native JSON serialization for OSCAL output
- **Testing:** Vitest
- **Package Manager:** npm

### Project Structure

```
attesting/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── LICENSE                          # MIT
│
├── src/
│   ├── index.ts                     # CLI entry point
│   ├── db/
│   │   ├── schema.sql               # SQLite schema
│   │   ├── migrations/              # Schema migrations
│   │   └── connection.ts            # DB connection manager
│   │
│   ├── models/                      # TypeScript interfaces matching DB tables
│   │   ├── catalog.ts
│   │   ├── control.ts
│   │   ├── mapping.ts
│   │   ├── implementation.ts
│   │   ├── assessment.ts
│   │   ├── organization.ts
│   │   └── evidence.ts
│   │
│   ├── commands/                    # CLI commands
│   │   ├── catalog/
│   │   │   ├── import.ts            # Import a control catalog
│   │   │   ├── list.ts              # List imported catalogs
│   │   │   └── inspect.ts           # Show controls in a catalog
│   │   │
│   │   ├── mapping/
│   │   │   ├── create.ts            # Create control-to-control mapping
│   │   │   ├── import.ts            # Bulk import mappings from CSV/JSON
│   │   │   ├── list.ts              # List mappings between two catalogs
│   │   │   └── resolve.ts           # Given a control, show all mapped equivalents
│   │   │
│   │   ├── implementation/
│   │   │   ├── add.ts               # Add implementation statement
│   │   │   ├── import.ts            # Bulk import from CSV/JSON
│   │   │   ├── list.ts              # List implementations for a scope
│   │   │   ├── status.ts            # Show implementation coverage stats
│   │   │   └── edit.ts              # Edit an existing implementation
│   │   │
│   │   ├── assessment/
│   │   │   ├── create.ts            # Create a new assessment
│   │   │   ├── evaluate.ts          # Run assessment against implementations
│   │   │   └── poam.ts              # Generate/manage POA&M items
│   │   │
│   │   ├── export/
│   │   │   ├── sig.ts               # Export as SIG-compatible questionnaire
│   │   │   ├── oscal.ts             # Export as OSCAL JSON/XML
│   │   │   ├── soa.ts               # Export as ISO 27001 SOA workbook
│   │   │   ├── cmmc.ts              # Export as CMMC self-assessment
│   │   │   ├── pdf.ts               # Export as PDF report
│   │   │   └── csv.ts               # Export as flat CSV
│   │   │
│   │   └── org/
│   │       ├── init.ts              # Initialize organization profile
│   │       └── scope.ts             # Define product/system scopes
│   │
│   ├── importers/                   # Framework-specific catalog importers
│   │   ├── oscal-catalog.ts         # Import from OSCAL JSON catalog
│   │   ├── sig-content-library.ts   # Import from SIG Manager Content Library
│   │   ├── nist-800-171.ts          # Import NIST 800-171 (from OSCAL source)
│   │   ├── iso-27001.ts             # Import ISO 27001:2022 Annex A
│   │   ├── cmmc.ts                  # Import CMMC 2.0 practices
│   │   ├── nispom.ts                # Import NISPOM 32 CFR 117 sections
│   │   └── csv-generic.ts           # Import any catalog from CSV
│   │
│   ├── exporters/                   # Output format generators
│   │   ├── sig-questionnaire.ts     # Generate SIG-compatible .xlsm
│   │   ├── oscal-json.ts            # Generate OSCAL JSON (all component types)
│   │   ├── oscal-xml.ts             # Generate OSCAL XML
│   │   ├── soa-workbook.ts          # Generate ISO 27001 SOA .xlsx
│   │   ├── cmmc-assessment.ts       # Generate CMMC self-assessment .xlsx
│   │   ├── pdf-report.ts            # Generate PDF compliance report
│   │   └── csv-flat.ts              # Generate flat CSV export
│   │
│   ├── mappers/                     # Cross-framework mapping logic
│   │   ├── resolver.ts              # Given control X, find all equivalents
│   │   ├── coverage.ts              # Calculate coverage across frameworks
│   │   └── gap-analysis.ts          # Identify gaps between frameworks
│   │
│   └── utils/
│       ├── oscal-types.ts           # OSCAL TypeScript type definitions
│       ├── uuid.ts                  # UUID generation
│       ├── dates.ts                 # Date formatting
│       └── logger.ts                # Logging utility
│
├── data/                            # Seed data and reference catalogs
│   ├── catalogs/
│   │   ├── nist-800-171-r2.json     # NIST 800-171 Rev 2 in OSCAL format
│   │   ├── nist-800-53-r5.json      # NIST 800-53 Rev 5 in OSCAL format
│   │   ├── sig-lite-2026.json       # SIG Lite 135 questions (converted)
│   │   ├── sig-core-2026.json       # SIG Core 853 questions (converted)
│   │   ├── iso-27001-2022.json      # ISO 27001:2022 Annex A controls
│   │   ├── cmmc-2.0.json            # CMMC 2.0 Level 2 practices
│   │   └── nispom-117.json          # NISPOM 32 CFR 117 sections
│   │
│   ├── mappings/
│   │   ├── sig-to-iso27001.csv      # SIG ↔ ISO 27001 mapping
│   │   ├── sig-to-nist800171.csv    # SIG ↔ NIST 800-171 mapping
│   │   ├── sig-to-cmmc.csv          # SIG ↔ CMMC mapping
│   │   ├── nist800171-to-cmmc.csv   # NIST 800-171 ↔ CMMC mapping
│   │   ├── iso27001-to-nist800171.csv
│   │   └── nispom-to-nist800171.csv
│   │
│   └── templates/
│       ├── sig-lite-template.xlsx   # SIG Lite output template with formatting
│       └── soa-template.xlsx        # SOA output template with formatting
│
├── tests/
│   ├── db/
│   │   └── schema.test.ts
│   ├── importers/
│   │   ├── sig-content-library.test.ts
│   │   └── oscal-catalog.test.ts
│   ├── mappers/
│   │   └── resolver.test.ts
│   ├── exporters/
│   │   └── sig-questionnaire.test.ts
│   └── commands/
│       └── implementation.test.ts
│
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA-MODEL.md
    ├── OSCAL-MAPPING.md
    └── SIG-COMPATIBILITY.md
```

---

## Database Schema

The SQLite schema is the heart of the system. Everything flows from this data model.

```sql
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
    -- This is the "write it once" content that answers the question across all frameworks
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
```

---

## CLI Command Reference

### Organization Setup

```bash
# Initialize a new organization
attesting org init --name "Nutanix, Inc." --cage-code "6RG48"

# Define a product/system scope
attesting scope create --name "On-Premises Products" \
  --description "Customers running Nutanix in their own data centers" \
  --type product
```

### Catalog Management

```bash
# Import NIST 800-171 from OSCAL JSON (download from NIST GitHub)
attesting catalog import --format oscal \
  --file data/catalogs/nist-800-171-r2.json \
  --name "NIST SP 800-171 Rev 2" \
  --short-name nist-800-171-r2

# Import SIG Lite from the SIG Manager Content Library export
# (User exports Content Library to CSV first, or we parse the .xlsm directly)
attesting catalog import --format sig \
  --file "path/to/SIG_Manager_2026.xlsm" \
  --scope-level lite \
  --name "SIG Lite 2026" \
  --short-name sig-lite-2026

# Import ISO 27001:2022 from CSV
attesting catalog import --format csv \
  --file data/catalogs/iso-27001-2022.csv \
  --name "ISO/IEC 27001:2022 Annex A" \
  --short-name iso-27001-2022 \
  --columns "control_id=A,title=B,description=C,category=D"

# List all imported catalogs
attesting catalog list

# Inspect controls in a catalog
attesting catalog inspect sig-lite-2026 --risk-domain A
attesting catalog inspect nist-800-171-r2 --family "Access Control"
```

### Control Mappings

```bash
# Import SIG-to-ISO27001 mappings from the SIG Content Library
# (The SIG Content Library already has ISO 27001:2022 mapping columns)
attesting mapping import --format csv \
  --file data/mappings/sig-to-iso27001.csv \
  --source-catalog sig-lite-2026 \
  --target-catalog iso-27001-2022

# Import SIG-to-NIST mappings
attesting mapping import --format csv \
  --file data/mappings/sig-to-nist800171.csv \
  --source-catalog sig-lite-2026 \
  --target-catalog nist-800-171-r2

# Create a single mapping manually
attesting mapping create \
  --source sig-lite-2026:A.1 \
  --target iso-27001-2022:A.5.1 \
  --relationship equivalent \
  --confidence high

# Resolve: given one control, show all mapped equivalents
attesting mapping resolve sig-lite-2026:A.1
# Output:
#   sig-lite-2026:A.1 → iso-27001-2022:A.5.1 (equivalent, high)
#   sig-lite-2026:A.1 → nist-800-171-r2:3.1.1 (related, medium)
#   sig-lite-2026:A.1 → cmmc-2.0:AC.L2-3.1.1 (equivalent, high)

# List all mappings between two catalogs
attesting mapping list --source sig-lite-2026 --target iso-27001-2022
```

### Implementation Statements

```bash
# Add an implementation statement for a control
attesting impl add \
  --control sig-lite-2026:A.1 \
  --scope "On-Premises Products" \
  --status implemented \
  --response Yes \
  --statement "Nutanix maintains a formalized risk governance policy approved by the board of directors. The policy defines the Enterprise Risk Management program requirements, is reviewed annually, and was last updated in January 2026." \
  --responsible-role "Risk Management" \
  --responsibility provider

# Bulk import implementations from CSV
# CSV columns: control_id, status, sig_response, statement, responsible_role, responsibility_type
attesting impl import --format csv \
  --file my-implementations.csv \
  --catalog sig-lite-2026 \
  --scope "On-Premises Products"

# Show implementation coverage stats
attesting impl status --scope "On-Premises Products"
# Output:
#   SIG Lite 2026:          89/135 implemented (65.9%)
#   ISO 27001:2022:         72/93 implemented (77.4%)
#   NIST 800-171 Rev 2:     68/110 implemented (61.8%)
#   (coverage includes controls resolved via mappings)

# List implementations for a specific framework
attesting impl list --catalog sig-lite-2026 --scope "On-Premises Products" --status not-implemented
```

### Export

```bash
# Export as SIG Lite Response SIG (.xlsm)
attesting export sig \
  --catalog sig-lite-2026 \
  --scope "On-Premises Products" \
  --format response-sig \
  --output "Nutanix_SIG_Lite_Response_OnPrem_2026.xlsm"

# Export as SIG questionnaire (blank, for sending to vendors)
attesting export sig \
  --catalog sig-lite-2026 \
  --scope "On-Premises Products" \
  --format questionnaire \
  --output "Nutanix_SIG_Lite_Questionnaire_2026.xlsm"

# Export as OSCAL component-definition (JSON)
attesting export oscal \
  --type component-definition \
  --scope "On-Premises Products" \
  --output nutanix-onprem-component.json

# Export as OSCAL system-security-plan (JSON)
attesting export oscal \
  --type ssp \
  --scope "On-Premises Products" \
  --catalogs sig-lite-2026,nist-800-171-r2 \
  --output nutanix-onprem-ssp.json

# Export as ISO 27001 SOA workbook
attesting export soa \
  --scope "On-Premises Products" \
  --output "Nutanix_ISO27001_SOA_2026.xlsx"

# Export as CMMC self-assessment
attesting export cmmc \
  --scope "On-Premises Products" \
  --level 2 \
  --output "Nutanix_CMMC_L2_SelfAssessment.xlsx"

# Export as PDF compliance summary report
attesting export pdf \
  --scope "On-Premises Products" \
  --catalogs sig-lite-2026,iso-27001-2022,nist-800-171-r2 \
  --output "Nutanix_Compliance_Summary_2026.pdf"

# Export full data as flat CSV (for analysis, Jira import, etc.)
attesting export csv \
  --scope "On-Premises Products" \
  --include-mappings \
  --output "attesting_full_export.csv"
```

### Assessment & POA&M

```bash
# Create an assessment
attesting assessment create \
  --name "CMMC Level 2 Self-Assessment Q1 2026" \
  --catalog cmmc-2.0 \
  --scope "On-Premises Products" \
  --type self

# Run assessment (compares implementations to controls, generates results)
attesting assessment evaluate \
  --assessment "CMMC Level 2 Self-Assessment Q1 2026"

# Generate POA&M from assessment findings
attesting assessment poam \
  --assessment "CMMC Level 2 Self-Assessment Q1 2026" \
  --output "Nutanix_CMMC_POAM.xlsx"
```

---

## SIG Compatibility Layer — Critical Requirements

The SIG export must produce output that is **indistinguishable** from a questionnaire generated by the real SIG Manager 2026. This is the single most important feature for adoption — if the output doesn't look right to a customer, nobody will use the tool.

### SIG Questionnaire Structure

A SIG questionnaire (.xlsm) has the following worksheets:

1. **Copyright** — Shared Assessments copyright notice (required, do not modify)
2. **Instructions** — Generic instructions + editable "Issuer/Outsourcer Additional Information" area
3. **Dashboard** — Progress tracking by section (auto-calculated)
4. **Business Information** — Company profile fields
5. **Documentation** — Documentation and Artifacts Request List
6. **SIG 2026** — The actual questions, hierarchical (parent questions conditionally show children)
7. **Full** — All questions flat, non-interactive

### SIG Response Fields Per Question

Each question row in the SIG 2026 worksheet has these columns:

| Column | Field | Type |
|--------|-------|------|
| A | Risk Domain | Text (read-only) |
| B | Question Number | Text (e.g., "A.1") |
| C | Question/Request | Text (the question) |
| D | Response | Dropdown: Yes, No, N/A |
| E | Additional Information | Free text (required if N/A) |
| F | Control Family | Text (read-only) |
| G | Control Attribute | Text (read-only) |
| H+ | Mapping References (up to 4) | Text (read-only) |

### SIG Response SIG Differences

A Response SIG is the same structure but:
- Response column (D) is pre-filled with Yes/No/N/A
- Additional Information column (E) is pre-filled with implementation details
- Business Information is pre-filled with company data
- Documentation tab has Document Access and Description pre-filled
- Can be locked to prevent modification

### SIG Hierarchical Questions

SIG questions are hierarchical. A parent question (e.g., A.1) may have child questions (A.1.1, A.1.2) that only appear when the parent is answered "Yes". The export must replicate this conditional visibility behavior. In the SIG Manager, this is handled by Excel macros that hide/show rows. In our export, we need to replicate this with Excel conditional formatting or VBA macros embedded in the output.

### Approach for SIG Export

1. Use the exceljs library to build the workbook programmatically
2. Replicate the exact column structure, headers, and formatting from a real SIG questionnaire
3. For Response SIGs, populate responses from the implementations table
4. For the hierarchical question behavior, embed minimal VBA that handles row visibility based on parent responses
5. Include all SIG-standard worksheets (Copyright, Instructions, Dashboard, Business Info, Documentation, SIG 2026, Full)

**IMPORTANT:** Do not distribute Shared Assessments' copyrighted content (question text) in the tool's source code or seed data. The tool imports question text from the user's licensed copy of the SIG Manager. The `sig-lite-2026.json` seed catalog should contain only the structure (question IDs, risk domains, control families, mappings) without the actual question text. The user populates question text by running `attesting catalog import --format sig` against their own licensed .xlsm file.

---

## OSCAL Output Format

The tool produces valid OSCAL 1.1.2 JSON. Here are the key document types:

### Component Definition

Used when describing a product's control implementations (analogous to a Response SIG).

```json
{
  "component-definition": {
    "uuid": "generated-uuid",
    "metadata": {
      "title": "Nutanix On-Premises Products - Control Implementation",
      "last-modified": "2026-04-08T00:00:00Z",
      "version": "1.0",
      "oscal-version": "1.1.2"
    },
    "components": [
      {
        "uuid": "component-uuid",
        "type": "software",
        "title": "Nutanix On-Premises Products",
        "description": "Nutanix hyperconverged infrastructure for on-premises deployment",
        "control-implementations": [
          {
            "uuid": "impl-uuid",
            "source": "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-171/rev2/json/NIST_SP-800-171_rev2_catalog.json",
            "description": "NIST 800-171 Rev 2 implementation for Nutanix on-prem products",
            "implemented-requirements": [
              {
                "uuid": "req-uuid",
                "control-id": "3.1.1",
                "description": "Nutanix enforces MFA on all privileged accounts using Okta..."
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### System Security Plan (SSP)

Full SSP linking a system to its control implementations, with responsible roles and status.

### Assessment Results

Maps to our assessment_results table. Includes findings, risk levels, and recommendations.

### Plan of Action and Milestones (POA&M)

Maps to our poam_items table. Tracks remediation of findings.

---

## Importer Specifications

### SIG Content Library Importer (`sig-content-library.ts`)

This is the most important importer. It reads the SIG Manager .xlsm file and extracts:

1. **Controls:** All questions from the Content Library worksheet
   - Column A: Include/Exclude
   - Column B: Serial No
   - Column C: Question Number
   - Column D: Question/Request text
   - Column E: Master Response
   - Column F: Comments/Notes
   - Column G: Importance
   - Column H: Control Family
   - Column I: Control Attribute
   - Column J: Scope Level (Lite/Core/Detail)
   - Columns K+: Mapping References (ISO 27001, NIST, CMMC, etc.)

2. **Mappings:** The mapping reference columns provide direct control-to-control mappings
   - Each mapping reference column header identifies the framework
   - Cell values contain the specific control/section reference within that framework

3. **Metadata:** Risk Domain, Control Family, Control Attribute, Scope Level, Serial Number

The importer should:
- Parse the .xlsm using exceljs (read-only mode, no macros needed for reading)
- Find the Content Library worksheet
- Extract controls with all metadata
- Extract mapping references and create cross-framework mappings
- Handle SIG's parent/child question hierarchy
- Store everything in the SQLite database

### OSCAL Catalog Importer (`oscal-catalog.ts`)

Reads NIST-published OSCAL catalogs (JSON format). NIST publishes these at:
- https://github.com/usnistgov/oscal-content

The importer should:
- Parse the OSCAL JSON catalog
- Extract controls with their IDs, titles, descriptions, and properties
- Handle nested control groups and enhancements
- Map OSCAL control properties to our metadata JSON field

### Generic CSV Importer (`csv-generic.ts`)

For any framework not already supported. User provides a CSV with configurable column mappings.

```bash
attesting catalog import --format csv \
  --file my-framework.csv \
  --name "My Custom Framework" \
  --short-name my-framework \
  --columns "control_id=A,title=B,description=C,category=D,guidance=E"
```

---

## Mapping Resolution Algorithm

The resolver is the core intelligence of the system. Given a control and an implementation, it determines which other controls across other frameworks are also satisfied.

### Resolution Logic

```
Given: Implementation I satisfies Control C in Catalog X
Find: All controls in all other catalogs that are also satisfied

1. Direct mappings:
   - Find all controls mapped to C (both directions)
   - For 'equivalent' relationships: fully satisfied
   - For 'subset' relationships (C is subset of target): target is partially satisfied
   - For 'superset' relationships (C is superset of target): target is fully satisfied
   - For 'related' relationships: mark as related but do not auto-satisfy

2. Transitive mappings (depth-limited to 2 hops):
   - If C maps to D, and D maps to E, then C transitively maps to E
   - Confidence degrades: high→medium on first hop, medium→low on second
   - Never auto-satisfy on transitive mappings; suggest for human review

3. Output:
   - List of (control, catalog, relationship, confidence, resolution_path)
   - Human reviews transitive suggestions and confirms/rejects
```

### Coverage Calculation

For a given scope and catalog:

```
total_controls = count of all controls in catalog
directly_implemented = controls with an implementation in status 'implemented'
mapped_implemented = controls mapped to an implemented control (equivalent or superset)
not_applicable = controls marked 'not-applicable'
coverage = (directly_implemented + mapped_implemented + not_applicable) / total_controls
```

---

## Key Design Decisions

### Why SQLite

- Local-first: runs on the user's machine with zero infrastructure
- Single file: easy to back up, version control, share
- Full SQL: complex cross-framework queries are natural
- FTS5: full-text search on control descriptions
- Good enough for tens of thousands of controls and mappings
- Can export to PostgreSQL later if the tool goes multi-user/SaaS

### Why TypeScript/Node

- exceljs is the best Excel manipulation library and it's Node-native
- OSCAL tooling ecosystem is strongest in JavaScript/TypeScript
- Single language for CLI, importers, exporters, and eventual web UI
- npm ecosystem for all other needs

### Why CLI First

- Compliance practitioners are increasingly technical
- CLI is scriptable, composable, and automatable
- CI/CD integration for automated compliance checks
- Web UI is Phase 2 — bolt it on top of the same data layer
- Lower barrier to initial development

### Why Not Just Extend SecurityPal

- SecurityPal is a SaaS product with its own data model and limitations
- Attesting is infrastructure-level: it feeds SecurityPal (and any other tool) with authoritative answers
- SecurityPal handles customer-facing questionnaire volume; Attesting handles the compliance truth layer underneath

---

## Phase 1 Implementation Plan (Build Order)

Build in this exact order. Each step produces a testable, useful increment.

### Step 1: Project Setup & Database
- Initialize TypeScript project with Commander.js
- Create SQLite schema
- Implement `org init` and `scope create` commands
- Write schema tests

### Step 2: Generic CSV Catalog Importer
- Build the CSV importer (most flexible, useful for testing)
- Create a test CSV with 10 controls
- Implement `catalog import --format csv`, `catalog list`, `catalog inspect`
- Test catalog CRUD operations

### Step 3: SIG Content Library Importer
- Build the SIG .xlsm parser using exceljs
- Extract all 2,909 controls with metadata
- Handle parent/child hierarchy
- Extract mapping reference columns
- Implement `catalog import --format sig`
- Test with the actual SIG Manager 2026 file

### Step 4: OSCAL Catalog Importer
- Build the OSCAL JSON parser
- Import NIST 800-171 Rev 2 from NIST's published catalog
- Import NIST 800-53 Rev 5
- Test control import and metadata extraction

### Step 5: Control Mapping Engine
- Implement `mapping create`, `mapping import`, `mapping list`
- Build the resolver algorithm
- Implement `mapping resolve` command
- Import SIG→ISO27001 and SIG→NIST mappings from SIG Content Library data
- Test bidirectional resolution and transitive mapping

### Step 6: Implementation Statements
- Implement `impl add`, `impl import`, `impl list`, `impl status`
- Build coverage calculation logic
- Test with a handful of implementations for the on-prem scope
- Verify that implementations resolve correctly across mapped frameworks

### Step 7: SIG Questionnaire Export
- Build the SIG-compatible .xlsm exporter
- Replicate the exact SIG questionnaire structure and formatting
- Generate Response SIG with pre-filled answers from implementations
- Generate blank questionnaire for vendor distribution
- Test by comparing output to a real SIG Manager-generated questionnaire

### Step 8: OSCAL Export
- Build OSCAL JSON exporter for component-definition
- Build OSCAL JSON exporter for SSP
- Validate output against OSCAL schemas
- Test with NIST's OSCAL validation tools

### Step 9: Additional Exports
- ISO 27001 SOA workbook export
- CMMC self-assessment workbook export
- PDF compliance summary report
- Flat CSV export

### Step 10: Assessment & POA&M
- Implement assessment creation and evaluation
- Build POA&M generation from assessment findings
- Export POA&M in OSCAL format and as Excel workbook

---

## Testing Strategy

### Unit Tests
- Every importer has a test with a small fixture file
- Every exporter has a test that generates output and validates structure
- Resolver has tests for direct, transitive, and bidirectional mapping
- Coverage calculation has tests for edge cases (no implementations, all N/A, partial)

### Integration Tests
- Import SIG Lite → add 10 implementations → export as Response SIG → verify output
- Import SIG + NIST → add mappings → add implementation for SIG control → verify NIST coverage resolves
- Full pipeline: import → map → implement → assess → export OSCAL

### Manual Validation
- Compare SIG export output side-by-side with real SIG Manager output
- Validate OSCAL output with NIST's oscal-cli validator
- Open exports in Excel and verify formatting, formulas, and conditional behavior

---

## What This Document Does NOT Cover (Future Phases)

- **Web UI:** React-based dashboard for visual control mapping and coverage tracking
- **Multi-user:** Authentication, RBAC, audit logging
- **API:** REST API for integration with other tools
- **CI/CD Integration:** GitHub Actions / GitLab CI for automated compliance checks on every deploy
- **AI-assisted mapping:** Using LLMs to suggest control mappings between frameworks
- **SBOM integration:** Linking SBOM components to supply chain controls
- **Continuous monitoring:** Automated evidence collection from cloud APIs
- **Marketplace:** Community-contributed framework catalogs and mapping packs

---

## Getting Started (for Claude Code)

1. Create the project directory and initialize:
   ```bash
   mkdir attesting && cd attesting
   npm init -y
   npm install typescript @types/node commander better-sqlite3 @types/better-sqlite3 exceljs uuid
   npm install -D vitest
   npx tsc --init
   ```

2. Start with Step 1 (project setup + database schema) and work through the build order sequentially.

3. After each step, run tests to verify before moving to the next step.

4. The first end-to-end demo should be: import SIG Lite from the .xlsm → add 5 implementation statements → export as Response SIG → open in Excel and verify it looks right.

5. The second demo should be: import NIST 800-171 → import SIG-to-NIST mappings → show that an implementation written for a SIG control automatically resolves to the corresponding NIST control.
