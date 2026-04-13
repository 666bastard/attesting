# Changelog

All notable changes to Attesting are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-04-13

### Added
- **Phase 4 complete**: all 11 connector adapters shipping — CISA KEV, NIST NVD, SBOM (CycloneDX + SPDX), CrowdStrike Falcon, ServiceNow, Jira, Splunk, Okta, Azure AD / Entra ID, AWS Security Hub, GCP Security Command Center
- **Phase 8A — Compliance Scoring Engine**: three-factor weighted formula (0.5 coverage / 0.3 evidence / 0.2 assessment), per-family breakdown, time-series history, propagation-driven auto-recalc, `attesting score` CLI group (show/snapshot/history/summary)
- **Phase 8B — Executive Dashboard**: single-call `/api/dashboard/summary` aggregator + React page with score gauge, per-framework bars, coverage breakdown, top risks, drift alerts, trend chart; print CSS for board handouts
- **Phase 8C — Audit-Ready Reports**: professional PDF + DOCX generators with cover page, executive summary, control inventory, evidence/risk/POA&M subsystems, methodology appendix. `attesting report audit` CLI, `/api/reports/audit` endpoint
- **Phase 8D — Continuous Monitoring**: posture monitor with threshold, delta, and trend alerting; configurable `monitoring_thresholds` with layered fallback; wired into drift scheduler; `attesting monitor` CLI (status/check/configure/thresholds)
- **Phase 8E — Evidence Lifecycle**: full state machine (draft → submitted → reviewed → accepted → expiring → expired → archived), reviewer workflow, renewal reminders, version chaining, freshness summary; `attesting evidence` CLI and React lifecycle page
- Drift scheduler grew from 6 → 8 scheduled checks (added `posture_monitor`, `evidence_expiry_sweep`)

### Changed
- **Phase 5H — Robustness Hardening**: all network adapters now use `fetchWithTimeout` wrapper with configurable per-connector timeouts (default 30s); adapter credential validation moved to constructors for fail-fast misconfiguration; propagation dispatcher wraps handler invocations in try/catch so one failing handler no longer crashes the caller; global Express error middleware returns consistent `{ error, code, status, details?, stack? }` envelope with production stack-trace suppression
- **Phase 5I — Package & Publish Readiness**: switched package to ESM (`"type": "module"`, `tsconfig module: "NodeNext"`), added `files` whitelist + `exports` field + `prepublishOnly` script, CLI `--version` now reads from `package.json`, shipped as npm-publishable tarball

### Fixed
- Latent bug in scoring's `loadControls()` — duplicate implementations per control no longer inflate coverage counts (pick-best-status via correlated subquery)
- NVD adapter now implements 429 Retry-After handling in the rate-limit loop

## [0.3.0] - 2026-04-09

### Added
- Phase 1: CLI parity — risk, intel, drift, and connector command groups (22 commands)
- Phase 2: Web UI pages — assets, intel, drift, connectors with glassmorphism design
- Phase 3: Test coverage — 288 tests across 44 files (propagation, disposition, intel, drift, connectors, API routes)
- Phase 4 (partial): NVD adapter with CVSS mapping and auto-corroboration; SBOM ingestion (CycloneDX + SPDX)
- Proprietary catalog import with file security scanning (SIG, ISO 27001, OSCAL, CSV)
- GitHub Actions CI pipeline (build, test, security, accessibility, OSCAL validation, catalog integrity)
- CodeQL code scanning, Dependabot, CODEOWNERS, SECURITY.md

## [0.2.0] - 2026-04-08

### Added
- GRC platform: governance module (policies, committees, roles), risk management, glassmorphism UI
- v2 integration: threat intelligence, asset inventory, drift detection, connectors, audit trail
- Propagation engine with entity graph traversal
- CISA KEV connector (operational)
- Disposition pipeline with NLP classification

## [0.1.0] - 2026-04-08

### Added
- Initial compliance engine: catalogs, controls, mappings, implementations
- OSCAL catalog importer (NIST 800-171, 800-53)
- SIG Content Library importer
- Generic CSV catalog importer
- Cross-framework control mapping with transitive resolution
- SIG questionnaire export, OSCAL export, CSV/PDF/SOA exports
- Assessment creation, evaluation, POA&M generation
- Web UI dashboard with React + Vite + Tailwind
