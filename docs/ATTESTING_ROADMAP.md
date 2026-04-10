# Attesting — Development Roadmap

**Generated:** 2026-04-09
**Baseline:** 23 CLI commands, 8 Web UI pages, all API routes live, propagation engine + all v2 services implemented, CISA KEV connector operational.

---

## Phase 1 — CLI Parity

**Goal:** Every service that has an API route also has a CLI command. The CLI becomes the complete operator interface.

**Why first:** Services and routes already exist. CLI commands are thin wrappers — fast to build, immediately testable, and they flush out API gaps before the Web UI depends on them.

### 1A · Risk CLI
- `attesting risk list` — list risk register with filters (status, severity, owner, source_type)
- `attesting risk create` — interactive or flag-based risk creation, calls `propagate()` on write
- `attesting risk update` — edit severity, status, owner; calls `propagate()` on change
- `attesting risk link` — link risk ↔ controls, risk ↔ assets
- `attesting risk exceptions` — list/create/expire risk exceptions
- `attesting risk matrix` — display or configure the risk matrix
- **Pattern:** follow `src/commands/assessment/create.ts`

### 1B · Intel CLI
- `attesting intel list` — list threat_inputs with source/platform/date filters
- `attesting intel submit` — submit manual intel (provisional), trigger `generateShadowImpact()`
- `attesting intel promote` — manually promote provisional → confirmed, trigger `promoteManualIntel()`
- `attesting intel corroborate` — run `checkAutoCorroboration()` on demand
- `attesting intel shadow` — display shadow impact analysis for a given intel entry
- **Pattern:** follow `src/commands/assessment/create.ts`, call intel services

### 1C · Drift CLI
- `attesting drift list` — list drift_alerts with status/type/severity filters
- `attesting drift check` — run all 6 drift checks on demand (or a specific check by name)
- `attesting drift dispose` — submit a natural-language disposition, run through NLP pipeline
- `attesting drift tasks` — list auto-generated disposition tasks
- `attesting drift schedule` — show/configure scheduler intervals
- **Pattern:** follow existing CLI pattern, call drift services + disposition pipeline

### 1D · Connector CLI
- `attesting connector list` — list registered connectors with health/sync status
- `attesting connector add` — register a new connector (type, config, schedule)
- `attesting connector sync` — trigger sync for a specific connector or all connectors
- `attesting connector log` — show sync history from connector_sync_log
- `attesting connector health` — check adapter health
- **Pattern:** follow existing CLI pattern, call connector services + AdapterRegistry

### Phase 1 exit criteria
- [ ] All commands above implemented and callable
- [ ] Each command has `--help` with usage examples
- [ ] Manual smoke test: full workflow from risk creation → intel submission → drift check → disposition

---

## Phase 2 — Web UI Coverage

**Goal:** Every API route group has a corresponding React page. The Web UI becomes the complete analyst interface.

**Why second:** API routes are already live and tested via Phase 1 CLI work. React pages consume the same endpoints — no backend changes needed.

### 2A · Assets Page
- Table view of asset inventory with search/filter (platform, boundary, owner)
- Create/edit asset form
- Asset detail view showing: linked threats (via threat_asset_correlations), linked risks (via risk_asset_links), boundary membership
- **Consumes:** `/api/assets`
- **Pattern:** follow `src/web/client/components/Risk.tsx`

### 2B · Intel Page
- Table of threat_inputs with source/platform/status filters
- Manual intel submission form with shadow impact preview panel
- Intel detail view: corroboration status, linked risks, linked assets
- Promotion action (provisional → confirmed) with confirmation dialog
- **Consumes:** `/api/intel`

### 2C · Drift Page
- Dashboard showing drift alert counts by type and severity
- Alert table with filters (type, status, severity, date range)
- Disposition workflow: inline natural-language response → NLP classification preview → submit → approval status
- Auto-generated tasks list with status tracking
- **Consumes:** `/api/drift`

### 2D · Connectors Page
- Registered connectors list with health indicators and last-sync timestamps
- Add/configure connector form
- Manual sync trigger with progress/result feedback
- Sync log history table
- **Consumes:** `/api/connectors`

### Phase 2 exit criteria
- [ ] All 4 pages implemented, routed in App.tsx, and navigable from sidebar
- [ ] Each page handles loading, empty, and error states
- [ ] Manual walkthrough: navigate all pages, create/edit entities, verify data round-trips through API

---

## Phase 3 — Test Coverage

**Goal:** Comprehensive test coverage for all v2 services. Confidence to refactor and release.

**Why third:** Now that CLI and Web UI exercise every code path, tests lock in the behavior. Writing tests after integration also catches real bugs discovered during Phase 1–2.

### 3A · Propagation Engine Tests
- Unit test each handler file in `src/services/propagation/`
- Test `propagate()` dispatcher routing to correct handlers
- Test `shadowPropagate()` produces impact analysis without side effects
- Edge cases: circular references, missing FK targets, concurrent propagation

### 3B · Disposition Pipeline Tests
- `classifier.ts` — all 6 disposition types + ambiguous input + edge cases
- `entity-extractor.ts` — MCAT, NIST, CMMC, NISPOM, Jira ticket, temporal refs
- `task-generator.ts` — task creation from various rationale patterns
- `approval.ts` — routing logic (high-risk → supervisor, low-risk → self-approve, TTL expiry)

### 3C · Intel Service Tests
- `manual-intel.ts` — submission, provisional status, promotion flow
- `shadow-analysis.ts` — dry-run produces correct impact without DB writes
- `auto-corroboration.ts` — CVE match, platform overlap, title similarity, no-match

### 3D · Drift & Connector Tests
- `checks.ts` — each of 6 drift checks with stale/fresh/edge-case data
- `scheduler.ts` — interval configuration, check dispatch
- `base-adapter.ts` — sync logging, upsert by external_id, health tracking
- `cisa-kev.ts` — transform correctness, deduplication, error handling

### 3E · API Route Integration Tests
- Test each route group with in-memory DB
- Verify propagation side effects fire on write endpoints
- Verify error responses for invalid input, missing entities, auth edge cases

### Phase 3 exit criteria
- [ ] All v2 service files have corresponding test files
- [ ] `npm run test` passes with no skipped tests
- [ ] Coverage report shows ≥80% line coverage on `src/services/` directory

---

## Phase 4 — Connector Ecosystem

**Goal:** Production-ready integrations with major security and IT platforms. Attesting becomes a real-time aggregation hub.

**Why last:** The framework is proven (CISA KEV works), CLI and UI can manage connectors, and tests ensure new adapters don't break existing behavior.

### 4A · Vulnerability & Threat Feeds
- **CrowdStrike Falcon** adapter — pull IOCs and vulnerability data, transform to threat_inputs
- **NIST NVD** adapter — CVE feed ingestion, auto-correlate with existing intel
- Verify auto-corroboration triggers when feeds match provisional manual intel

### 4B · IT Service Management
- **ServiceNow** adapter — pull incidents/changes, map to evidence or risk events
- **Jira** adapter — sync tickets referenced in dispositions, link to disposition_tasks

### 4C · SIEM & Log Aggregation
- **Splunk** adapter — pull notable events, transform to threat_inputs or evidence
- Architecture decision: push (webhook) vs pull (scheduled) — document tradeoffs

### 4D · Identity & Access
- **Okta** adapter — pull user/group data, map to owners + assets
- **Azure AD / Entra ID** adapter — same scope as Okta

### 4E · Cloud Posture
- **AWS Security Hub** adapter — pull findings, map to controls + risks
- **Azure Defender** / **GCP SCC** adapter — same pattern

### 4F · SBOM Ingestion
- **CycloneDX** importer — parse SBOM, create asset entries with component metadata
- **SPDX** importer — same scope
- Link SBOM components to vulnerability feeds for automated risk correlation

### Phase 4 exit criteria
- [ ] Each adapter has: implementation, tests, CLI registration, API registration, UI display
- [ ] Sync/health/log lifecycle works end-to-end for each adapter
- [ ] Documentation: setup guide per connector (API keys, permissions, polling config)

---

## Phase 5 — Release Hardening

**Goal:** Polish for public consumption. Documentation, developer experience, and operational readiness.

### Tasks
- README overhaul: quickstart, screenshots, architecture diagram
- `attesting init` wizard improvements (guided org setup)
- Error messages audit — user-friendly, actionable messages everywhere
- CLI `--output json` flag on all commands for scripting/piping
- API OpenAPI/Swagger spec generation
- GitHub Actions CI: build + test + catalog integrity + OSCAL validation
- CHANGELOG.md and semantic versioning
- License headers on all source files
- Contributing guide (CONTRIBUTING.md)
- Docker/container packaging for single-command deployment

### Phase 5 exit criteria
- [ ] A new user can clone, install, and run Attesting in under 5 minutes
- [ ] CI passes on every PR
- [ ] All CLI commands have `--help` and man-style documentation
- [ ] Public repo is clean: no secrets, no dead code, no TODO comments in shipped code

---

## Sequencing summary

| Phase | Focus | Depends on |
|-------|-------|------------|
| 1 | CLI parity (risk, intel, drift, connectors) | Services + routes (done) |
| 2 | Web UI pages (assets, intel, drift, connectors) | API routes (done) + Phase 1 flushes bugs |
| 3 | Test coverage for v2 services | Phase 1–2 stabilize the code paths |
| 4 | Connector ecosystem expansion | Phase 3 ensures safety net |
| 5 | Release hardening & documentation | Phase 1–4 complete |

Phases 1A–1D and 2A–2D can be worked in any internal order. The sub-phases within Phase 4 are independent and can be prioritized by which integrations matter most to your deployment context.