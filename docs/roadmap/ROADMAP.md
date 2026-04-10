# Attesting Roadmap

**Updated:** 2026-04-09 · **Status legend:** ✅ Done · 🔧 In Progress · 📋 Planned · 💡 Future

Each item links to a detailed spec in `docs/roadmap/`. Specs define scope, files to create/modify, dependencies, exit criteria, and Claude Code prompts.

## Phase 1 — CLI Parity

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 1A | Risk CLI (list, create, update, link, exceptions, matrix) | ✅ | [risk-cli.md](risk-cli.md) |
| 1B | Intel CLI (list, submit, promote, corroborate, shadow) | ✅ | [intel-cli.md](intel-cli.md) |
| 1C | Drift CLI (list, check, dispose, tasks, schedule) | ✅ | [drift-cli.md](drift-cli.md) |
| 1D | Connector CLI (list, add, sync, log, health) | ✅ | [connector-cli.md](connector-cli.md) |

## Phase 2 — Web UI Coverage

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 2A | Assets page | ✅ | [assets-page.md](assets-page.md) |
| 2B | Intel page (threat feeds + manual intel) | ✅ | [intel-page.md](intel-page.md) |
| 2C | Drift page (alerts + dispositions) | ✅ | [drift-page.md](drift-page.md) |
| 2D | Connectors page | ✅ | [connectors-page.md](connectors-page.md) |

## Phase 3 — Test Coverage

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 3A | Propagation engine tests | ✅ | [test-propagation.md](test-propagation.md) |
| 3B | Disposition pipeline tests | ✅ | [test-disposition.md](test-disposition.md) |
| 3C | Intel service tests | ✅ | [test-intel.md](test-intel.md) |
| 3D | Drift & connector tests | ✅ | [test-drift-connectors.md](test-drift-connectors.md) |
| 3E | API integration tests | ✅ | [test-api-integration.md](test-api-integration.md) |

## Phase 4 — Connector Ecosystem

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 4A | CrowdStrike Falcon adapter | 📋 | [adapter-crowdstrike.md](adapter-crowdstrike.md) |
| 4B | NIST NVD adapter | ✅ | [adapter-nvd.md](adapter-nvd.md) |
| 4C | ServiceNow adapter | 📋 | [adapter-servicenow.md](adapter-servicenow.md) |
| 4D | Jira adapter | 📋 | [adapter-jira.md](adapter-jira.md) |
| 4E | Splunk adapter | 📋 | [adapter-splunk.md](adapter-splunk.md) |
| 4F | Okta adapter | 📋 | [adapter-okta.md](adapter-okta.md) |
| 4G | Azure AD / Entra ID adapter | 📋 | [adapter-azure-ad.md](adapter-azure-ad.md) |
| 4H | AWS Security Hub adapter | 📋 | [adapter-aws.md](adapter-aws.md) |
| 4I | Azure Defender adapter | 📋 | [adapter-azure-defender.md](adapter-azure-defender.md) |
| 4J | GCP Security Command Center adapter | 📋 | [adapter-gcp-scc.md](adapter-gcp-scc.md) |
| 4K | SBOM ingestion (CycloneDX + SPDX) | ✅ | [adapter-sbom.md](adapter-sbom.md) |

## Phase 5 — Release Hardening

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 5A | README + quickstart + architecture diagram | ✅ | [docs-readme.md](docs-readme.md) |
| 5B | CLI `--output json` on all commands | ✅ | [cli-json-output.md](cli-json-output.md) |
| 5C | OpenAPI spec generation | ✅ | [openapi-spec.md](openapi-spec.md) |
| 5D | GitHub Actions CI pipeline | ✅ | [ci-pipeline.md](ci-pipeline.md) |
| 5E | Docker packaging | ✅ | [docker.md](docker.md) |
| 5F | CONTRIBUTING.md + developer guide | ✅ | [contributing.md](contributing.md) |
| 5G | Changelog + semantic versioning | ✅ | [versioning.md](versioning.md) |
| 5H | Onboarding wizard (CLI + Web UI) | ✅ | [onboarding-wizard.md](onboarding-wizard.md) |

## Phase 6 — Proprietary Import

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 6A | File scanner + format autodetection | ✅ | [import-scanner.md](import-scanner.md) |
| 6B | SIG Full / ISO 27001 parsers | ✅ | [import-parsers.md](import-parsers.md) |
| 6C | Import API route (preview + confirm) | ✅ | [import-api.md](import-api.md) |
| 6D | Import CLI command | ✅ | [import-cli.md](import-cli.md) |
| 6E | Import Web UI (upload + preview + confirm) | ✅ | [import-web-ui.md](import-web-ui.md) |

## Phase 7 — Access Control & Multi-Tenancy

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 7A | RBAC (roles, permissions, route guards) | 💡 | [rbac.md](rbac.md) |
| 7B | Authentication (local + SSO/SAML) | 💡 | [authentication.md](authentication.md) |
| 7C | Multi-org tenancy | 💡 | [multi-tenancy.md](multi-tenancy.md) |
| 7D | Audit log viewer with filters + export | 💡 | [audit-viewer.md](audit-viewer.md) |

## Phase 8 — Compliance Scoring & Reporting

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 8A | Compliance score engine (per catalog, per scope) | 💡 | [compliance-scoring.md](compliance-scoring.md) |
| 8B | Executive dashboard (posture summary, trends) | 💡 | [executive-dashboard.md](executive-dashboard.md) |
| 8C | Audit-ready report generator (PDF/DOCX) | 💡 | [audit-reports.md](audit-reports.md) |
| 8D | Continuous monitoring dashboard | 💡 | [continuous-monitoring.md](continuous-monitoring.md) |
| 8E | Evidence lifecycle management | 💡 | [evidence-lifecycle.md](evidence-lifecycle.md) |

## Phase 9 — Automation & Workflows

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 9A | Notification engine (email, Slack, webhook) | 💡 | [notifications.md](notifications.md) |
| 9B | Scheduled report delivery | 💡 | [scheduled-reports.md](scheduled-reports.md) |
| 9C | Custom workflow builder (if/then rules) | 💡 | [workflow-builder.md](workflow-builder.md) |
| 9D | Bulk operations (mass-assign, mass-update) | 💡 | [bulk-operations.md](bulk-operations.md) |
| 9E | API key management for external integrations | 💡 | [api-keys.md](api-keys.md) |

## Phase 10 — Advanced Platform

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 10A | Control inheritance + scoped overlays | 💡 | [control-inheritance.md](control-inheritance.md) |
| 10B | Gap analysis wizard | 💡 | [gap-analysis.md](gap-analysis.md) |
| 10C | Vendor risk management module | 💡 | [vendor-risk.md](vendor-risk.md) |
| 10D | Policy document management (versioning, approval) | 💡 | [policy-management.md](policy-management.md) |
| 10E | Training & awareness tracking | 💡 | [training-tracking.md](training-tracking.md) |
| 10F | Incident response integration | 💡 | [incident-response.md](incident-response.md) |