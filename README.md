# Attesting

[![CI](https://github.com/xtonyknucklesx/attesting/actions/workflows/ci.yml/badge.svg)](https://github.com/xtonyknucklesx/attesting/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](package.json)
[![Tests](https://img.shields.io/badge/tests-664%20passing-brightgreen)](tests/)

**OSCAL-native, local-first GRC platform.** Attesting treats governance, risk, and compliance as one connected graph — controls, evidence, risks, and threats all flow through a single SQLite database and propagate to each other as state changes.

## What it is

Attesting is a CLI + Web UI + HTTP API for teams that need to satisfy multiple compliance frameworks without spreadsheets. You import control catalogs (NIST 800-53, ISO 27001, CMMC, SIG, 10+ more), write implementation statements once, and they resolve across every mapped framework. Evidence moves through a lifecycle state machine. Compliance scores recompute when implementations or evidence change. A drift scheduler watches the graph and raises alerts when something slips. Audit-ready PDF/DOCX reports ship with one command.

Everything runs locally against a single SQLite file. No cloud dependency, no account required, no proprietary lock-in. OSCAL 1.1.2 is the native data model.

## Key features

- **14 bundled catalogs** — NIST 800-53 (+4 baselines), 800-171, CSF 2.0, 800-218, ISO 27001, CMMC 2.0, HIPAA, SOC 2, PCI DSS 4.0, GDPR, CCPA/CPRA, EU AI Act, NISPOM
- **282 pre-resolved cross-framework mappings** — write once, satisfy many
- **Compliance scoring engine** (Phase 8A) — weighted three-factor formula with per-family breakdown and time-series history
- **Executive dashboard** (Phase 8B) — single-call aggregated posture summary with gauge, trend, risk, drift, POA&M widgets; printable board handouts
- **Audit-ready reports** (Phase 8C) — professional PDF and DOCX generators with cover, control inventory, risk summary, methodology appendix
- **Continuous monitoring** (Phase 8D) — threshold, delta, and trend alerting wired into the drift scheduler
- **Evidence lifecycle** (Phase 8E) — strict state machine (draft → submitted → reviewed → accepted → expiring → expired → archived), reviewer workflow, renewal reminders, version chaining
- **11 connector adapters** — CISA KEV, NIST NVD, SBOM (CycloneDX + SPDX), CrowdStrike, ServiceNow, Jira, Splunk, Okta, Azure AD, AWS Security Hub, GCP SCC
- **Drift detection engine** — 8 scheduled checks for evidence staleness, policy reviews, risk exceptions, disposition expiry, posture monitor, evidence expiry sweep
- **Propagation engine** — state changes cascade automatically (implementation change → risk recalc → score snapshot → alert)
- **CLI + Web UI + HTTP API** — every capability available in all three surfaces
- **664 tests, 100% pass rate** — across 71 files

## Quick start

```bash
npm install -g attesting      # requires Node 20+
attesting org init --name "Acme Corp"
attesting scope create --name "Production" --type product

# Import a bundled framework
attesting catalog import --format oscal \
  --file data/catalogs/nist-800-53-r5.json \
  --name "NIST SP 800-53 Rev 5" --short-name nist-800-53-r5

# Check coverage
attesting score show --catalog nist-800-53-r5 --scope Production

# Start the web UI + API
attesting serve --port 3000
# → browse http://localhost:3000 for the dashboard
# → http://localhost:3000/api/docs for Swagger UI
```

## CLI reference

Every command supports `--json` for machine-readable output. Run `attesting <group> --help` for full details.

### Catalog management
- `catalog import` — import a catalog (OSCAL JSON, SIG .xlsm, CSV)
- `catalog list` — list all imported catalogs
- `catalog inspect` — show catalog contents + control count
- `catalog diff` — compare two catalog versions
- `catalog impact` — impact analysis for catalog updates
- `catalog update` — update catalog from source
- `catalog refresh` — re-import catalog from its original file
- `catalog watch` — register a catalog source for update notifications

### Mappings
- `mapping create` — create a single control-to-control mapping
- `mapping import` — bulk import mappings from CSV
- `mapping list` — list mappings with filters
- `mapping resolve` — resolve direct + transitive mappings for a control
- `mapping auto-link` — suggest mappings via similarity

### Implementations
- `impl add` — add an implementation statement
- `impl edit` — edit an implementation
- `impl list` — list implementations with filters
- `impl status` — coverage summary for a scope
- `impl import` — bulk import implementations from CSV

### Risk register
- `risk create` — create a risk
- `risk list` — list risks with filters
- `risk update` — update a risk
- `risk link` — link controls to a risk
- `risk exceptions` — manage risk exceptions
- `risk matrix` — view/update the risk matrix

### Compliance scoring (Phase 8A)
- `score show` — show current score for a catalog + scope
- `score snapshot` — persist a new snapshot
- `score history` — show score trend over time
- `score summary` — cross-catalog summary for a scope

### Evidence lifecycle (Phase 8E)
- `evidence list` — list evidence with status/implementation filters
- `evidence show` — detail + full state history
- `evidence create` — add a new evidence artifact (starts as draft)
- `evidence transition` — apply a state machine action (submit/review/accept/reject/renew/archive)
- `evidence freshness` — cross-catalog freshness summary

### Continuous monitoring (Phase 8D)
- `monitor status` — current posture findings across all catalogs
- `monitor check` — run the posture monitor on demand
- `monitor configure` — set per-scope/catalog thresholds
- `monitor thresholds` — list or resolve configured thresholds

### Audit reports (Phase 8C)
- `report audit` — generate an audit-ready PDF or DOCX report

### Intelligence
- `intel list` — list threat inputs
- `intel submit` — submit manual intel
- `intel promote` — promote provisional intel to confirmed
- `intel corroborate` — auto-corroborate against threat feeds
- `intel shadow` — show shadow impact of hypothetical intel

### Drift & dispositions
- `drift list` — list open drift alerts
- `drift check` — run a named drift check
- `drift dispose` — create a disposition for an alert
- `drift tasks` — list disposition tasks
- `drift schedule` — view or update the drift check schedule

### Connectors (11 adapters)
- `connector add` — register a connector
- `connector list` — list configured connectors
- `connector sync` — trigger a sync
- `connector log` — show sync logs
- `connector health` — run a health check

### Export
- `export pdf` — generic PDF export (for audit reports use `report audit`)
- `export csv` — flat CSV with implementations + mappings
- `export oscal` — OSCAL JSON (component-definition, SSP)
- `export sig` — SIG questionnaire response workbook
- `export soa` — ISO 27001 Statement of Applicability workbook

### Assessment & POA&M
- `assessment create` — create a new assessment
- `assessment evaluate` — evaluate an assessment against implementations
- `assessment poam` — generate POA&M items from unmet results

### Organization
- `org init` — initialize your organization profile
- `scope create` / `scope list` — manage product/system scopes

### Setup & web
- `setup` — interactive onboarding wizard
- `serve` — start the web UI + HTTP API

## API

The Express API exposes every domain as a REST namespace. Start the server with `attesting serve` and browse:

- **`http://localhost:3000/api/docs`** — Swagger UI with all 77 paths documented (OpenAPI 3.1)
- **`http://localhost:3000/api/docs/openapi.json`** — raw spec

Mounted namespaces:

| Namespace | Domain |
|---|---|
| `/api/org` | Organization profile + scopes |
| `/api/catalogs` | Framework catalogs + controls (FTS) |
| `/api/mappings` | Cross-framework mappings |
| `/api/implementations` | Implementation statements |
| `/api/coverage` | Per-catalog coverage aggregates |
| `/api/governance` | Policies, committees, roles |
| `/api/risk` | Risk register, matrix, exceptions |
| `/api/intel` | Threat inputs + manual intel |
| `/api/drift` | Drift alerts + dispositions |
| `/api/assets` | Asset inventory |
| `/api/connectors` | Data connectors + adapters |
| `/api/owners` | Owner/person directory |
| `/api/audit` | Immutable audit trail |
| `/api/export` | CSV/OSCAL/SIG/SOA/PDF export |
| `/api/diff` | Catalog diff |
| `/api/scores` | **Compliance scoring (Phase 8A)** |
| `/api/dashboard/summary` | **Executive dashboard (Phase 8B)** |
| `/api/reports/audit` | **Audit-ready PDF/DOCX (Phase 8C)** |
| `/api/monitoring` | **Continuous monitoring (Phase 8D)** |
| `/api/evidence` | **Evidence lifecycle (Phase 8E)** |

Global rate limit: 100 requests / 60 seconds. Errors use a consistent `{ error, code, status, details?, stack? }` envelope.

## Web UI

React 19 + Tailwind + Recharts dashboard, served at `http://localhost:3000/` when `attesting serve` is running. Pages:

- **Dashboard** — executive summary with score gauge, per-framework bars, trend, risk posture, drift alerts
- **Catalogs / Controls** — browse imported frameworks
- **Implementations** — edit implementation statements
- **Mappings** — explore cross-framework relationships
- **Risk** — register, matrix, exceptions
- **Assets** — inventory + threat correlation
- **Intel** — threat inputs + manual intel with shadow analysis
- **Drift** — alert feed + disposition workflow
- **Connectors** — configure + trigger adapters
- **Governance** — policies, committees, roles
- **Evidence** — lifecycle queue with status badges + inline transitions
- **Exports** — one-click exports + audit report generator

## Configuration

Attesting stores all state under `~/.attesting/`:

- `~/.attesting/attesting.db` — the SQLite database (schema + 6 migrations)
- `~/.attesting/exports/` — generated export files
- `~/.attesting/reports/` — generated audit reports
- `~/.attesting/uploads/` — staged import files

Environment variables:

- `NODE_ENV` — set to `production` to suppress stack traces in error responses

Node ≥20 required.

## Architecture

**Local-first.** Single SQLite file, no external services required. Schema defined in `src/db/schema.sql` + numbered migrations under `src/db/migrations/` (006 and counting).

**Propagation engine** (`src/services/propagation/`) — every write passes through a dispatcher that routes to entity-specific handlers. Evidence changes trigger score recalculation. Implementation status changes trigger risk recalculation. Handler errors are caught per-handler so one bad cascade can't crash the caller.

**Drift scheduler** (`src/services/drift/scheduler.ts`) — runs 8 periodic checks: evidence staleness (5min), policy reviews (hourly), risk exceptions (hourly), disposition expiry (hourly), manual intel expiry (hourly), posture monitor (hourly), evidence expiry sweep (hourly), full posture recalc (daily).

**Connector adapters** (`src/services/connectors/adapters/`) — each inbound adapter extends `BaseAdapter` with `fetch()` + `transform()`. All HTTP calls go through `fetchWithTimeout` with configurable per-connector timeouts (default 30s). Credentials validated at construction.

## Bundled catalogs

| Catalog | Short name | Source format |
|---|---|---|
| NIST SP 800-53 Rev 5 (full) | `nist-800-53-r5` | OSCAL JSON |
| NIST 800-53 Low baseline | `nist-800-53-r5-low` | OSCAL JSON |
| NIST 800-53 Moderate baseline | `nist-800-53-r5-moderate` | OSCAL JSON |
| NIST 800-53 High baseline | `nist-800-53-r5-high` | OSCAL JSON |
| NIST 800-53 Privacy baseline | `nist-800-53-r5-privacy` | OSCAL JSON |
| NIST SP 800-171 Rev 3 | `nist-800-171-r3` | OSCAL JSON |
| NIST Cybersecurity Framework 2.0 | `nist-csf-2.0` | OSCAL JSON |
| NIST SP 800-218 (SSDF) | `nist-800-218` | OSCAL JSON |
| CMMC 2.0 Level 2 | `cmmc-2.0` | CSV |
| ISO/IEC 27001:2022 | *(bring your own)* | CSV |
| HIPAA Security Rule | `hipaa-security` | CSV |
| SOC 2 Trust Services Criteria | `soc2-tsc` | CSV |
| PCI DSS 4.0 | `pci-dss-4` | CSV |
| GDPR | `gdpr` | CSV |
| CCPA / CPRA | `ccpa-cpra` | CSV |
| EU AI Act | `eu-ai-act` | CSV |
| NISPOM 32 CFR 117 | `nispom-117` | CSV |
| SIG Lite 2026 | *(bring your own .xlsm)* | SIG XLSM |

Copyrighted framework text (SIG questions, ISO 27001 control bodies) is **not** shipped. Bring your own licensed source file and Attesting imports only the structural metadata.

## Connector adapters (Phase 4)

| Adapter | Connects to | Auth |
|---|---|---|
| CISA KEV | Known Exploited Vulnerabilities feed | none (public) |
| NIST NVD | National Vulnerability Database | optional API key |
| SBOM CycloneDX | CycloneDX SBOM files | file-based |
| SBOM SPDX | SPDX SBOM files | file-based |
| CrowdStrike Falcon | Detections API | OAuth2 client credentials |
| ServiceNow | Incident / Security Incident table | Basic auth |
| Jira | Issues via JQL search | Basic auth + API token |
| Splunk | Search API (async jobs) | Bearer token |
| Okta | System Log | SSWS API token |
| Azure AD / Entra ID | Identity Protection risk detections | OAuth2 client credentials |
| AWS Security Hub | GetFindings (ASFF) | SigV4 |
| GCP Security Command Center | Findings API | Service-account JWT |

All adapters: fail-fast credential validation on construction, 30s fetch timeout (configurable), 429 Retry-After handling, structured error responses.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, architecture overview, how to add a connector, and how to add a framework catalog.

## License

[MIT](LICENSE) © Anthony Rossi III

See [CHANGELOG.md](CHANGELOG.md) for release history.
