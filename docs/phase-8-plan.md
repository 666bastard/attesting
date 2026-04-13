# Phase 8 Plan — Compliance Scoring, Dashboards & Reports

**Status:** Planning · **Date:** 2026-04-13 · **Depends on:** Phases 1–6 complete, Phase 4 adapters complete

---

## 1. What Phase 8 Delivers

Phase 8 is the layer that turns raw compliance state (controls, implementations, evidence, risks, drift alerts) into **decisions, reports, and operational insight**. Five sub-phases drawn directly from `docs/roadmap/`:

| Spec | File | Delivers |
|---|---|---|
| **8A** | `compliance-scoring.md` | Stateless scoring service with persisted per-catalog/per-scope scores, three-factor formula (0.5 × implemented + 0.3 × fresh evidence + 0.2 × passing assessments), per-family breakdown, 30/90/365-day trend, auto-recalc on propagate |
| **8B** | `executive-dashboard.md` | Leadership page with 8 widgets (overall score gauge, per-framework bars, 5×5 risk heat map, top-10 risks, drift summary, evidence health, exception timeline, trend chart) backed by one `/api/dashboard/executive` aggregator, printable |
| **8C** | `audit-reports.md` | Templated PDF + DOCX report generator for 6 report types (SSP, POA&M, Risk Assessment, Compliance Summary, Evidence Package, Third-Party Assessment), headers/footers/TOC/page numbers, new `export report` CLI + route |
| **8D** | `continuous-monitoring.md` | Ops page with 6 live widgets (alert feed, connector health, coverage gaps, recent changes, scheduler status, risk movement) backed by `/api/dashboard/monitoring`, 60s auto-refresh, click-through |
| **8E** | `evidence-lifecycle.md` | Full evidence state machine (draft → submitted → reviewed → approved → active → expiring → expired → archived), review workflow, renewal reminders (30/60/90-day), version history, bulk renewal |

---

## 2. What Already Exists (Build-On Inventory)

### Strong foundation we can reuse

- **Propagation system** — [src/services/propagation/dispatcher.ts](src/services/propagation/dispatcher.ts) already dispatches entity events with handlers for policy, evidence, asset, risk, threat, connector, disposition. We add a scoring handler rather than invent anything new.
- **Drift scheduler** — [src/services/drift/scheduler.ts](src/services/drift/scheduler.ts) already runs 6 scheduled checks (5min → 24h). Evidence renewal reminders hook in here.
- **Evidence staleness detection** — `checkEvidenceStaleness()` already flags expiring evidence into drift_alerts. 8E layers lifecycle state transitions on top.
- **Coverage aggregation** — [src/web/routes/coverage.ts](src/web/routes/coverage.ts) already computes per-catalog coverage. 8A extends this with weighted scoring.
- **Audit log** — `audit_log` table captures all entity changes → directly feeds "recent changes" widget (8D).
- **Dashboard page** — [src/web/client/components/dashboard/](src/web/client/components/dashboard/) has `Dashboard`, `CoverageCard`, `GapSummary`, `RecentActivity`, `FrameworkGrid`. 8B adds sibling Executive view; existing page stays as operational summary.
- **PDF exporter** — [src/exporters/pdf-report.ts](src/exporters/pdf-report.ts) uses pdfkit (basic summary). 8C extends with templates + adds `docx` package.
- **Risk system** — risks, risk_matrix, risk_exceptions, risk_controls all exist with propagation. 8B heat map and 8C Risk Assessment Report reuse these.
- **Evidence model** — [src/models/evidence.ts](src/models/evidence.ts) exists. 8E adds lifecycle columns via migration.

### Critical gaps (must build)

- No `compliance_scores` table or scoring service
- No scoring propagation handler
- No executive or monitoring dashboard routes/pages
- No DOCX export, no templated audit reports, no `export report` command
- No `evidence.status` column or lifecycle service
- No renewal reminder scheduler check
- No `ComplianceScore`, `ExecutiveDashboard`, `MonitoringDashboard` type models

### Migration starting point

Latest migration is **`003_controls_family_column.sql`**. Phase 8 migrations start at **`004`**.

---

## 3. Ordered Task List with Complexity

Complexity key: **S** = half-day, **M** = 1–2 days, **L** = 3+ days.

### 8A — Compliance Score Engine

| # | Task | Complexity | Notes |
|---|---|---|---|
| A1 | Migration `004_compliance_scores.sql` — create `compliance_scores` (id, catalog_id, scope_id, overall_score, breakdown_json, family_breakdown_json, calculated_at) + index on (catalog_id, scope_id, calculated_at DESC) | S | |
| A2 | Model `src/models/compliance-score.ts` — TS interface + query helpers | S | |
| A3 | Service `src/services/scoring/compliance-score.ts` — `calculateScore(db, catalogId, scopeId?)` implementing 0.5/0.3/0.2 formula, per-family breakdown, trend helpers | M | Stateless; read-only queries + single insert |
| A4 | Propagation handler `src/services/propagation/scoring-handlers.ts` — on evidence/implementation/assessment change, recalc affected (catalog, scope) pairs and persist | M | Must be idempotent, dedupe writes within transaction |
| A5 | Wire scoring handler into `dispatcher.ts` for `evidence`, `implementation`, `assessment_result` entity types | S | |
| A6 | Route `GET /api/coverage/:catalogId/score` + `GET /api/coverage/scores` (all catalogs) | S | In `src/web/routes/coverage.ts` |
| A7 | CLI `attesting assessment score --catalog <name> [--scope <name>] [--json]` | S | `src/commands/assessment/score.ts` |
| A8 | Tests: scoring formula (unit), propagation-triggered recalc, CLI, route | M | Add to `tests/services/scoring/` + `tests/commands/` + `tests/web/routes/` |

**8A deliverable:** scores persisted, auto-updated on propagate, queryable via CLI + API.

### 8B — Executive Dashboard

| # | Task | Complexity | Notes |
|---|---|---|---|
| B1 | Model `src/models/executive-dashboard.ts` — aggregated response type | S | |
| B2 | Service `src/services/dashboards/executive.ts` — composes widget data from scores, risks, drift_alerts, evidence, exceptions; takes date-range param | M | Pure read-only, heavy JOIN work |
| B3 | Route `GET /api/dashboard/executive?range=30d` | S | New file `src/web/routes/dashboards.ts` |
| B4 | Page `src/web/client/components/dashboard/ExecutiveDashboard.tsx` + sub-widgets (ScoreGauge, FrameworkBars, RiskHeatMap, TopRisksList, DriftSummary, EvidenceHealth, ExceptionTimeline, TrendChart) | L | Recharts already in deps |
| B5 | Router entry `/dashboard/executive` + nav link in Sidebar | S | |
| B6 | Print CSS (single-page board handout) | S | `@media print` rules |
| B7 | Tests: route integration, widget rendering smoke tests | M | |

**Depends on:** 8A (needs `compliance_scores` data).

### 8C — Audit-Ready Report Generator

| # | Task | Complexity | Notes |
|---|---|---|---|
| C1 | Add `docx` npm dep; create `src/exporters/docx-report.ts` base with header/footer/TOC helpers | M | |
| C2 | Refactor `pdf-report.ts` to template-based structure (header, footer, TOC, page numbers, cover page) | M | Keep existing callers working |
| C3 | Report template: **System Security Plan** (per-family implementation narrative) — PDF + DOCX | M | |
| C4 | Report template: **POA&M** (open items table w/ owners, deadlines) — PDF + DOCX | M | Reuse `poam_items` table |
| C5 | Report template: **Risk Assessment Report** (register + 5×5 matrix + treatment plan) — PDF + DOCX | M | |
| C6 | Report template: **Compliance Summary** (per-framework score + control detail) — PDF + DOCX | M | Depends on 8A scoring |
| C7 | Report template: **Evidence Package** (index + freshness per control) — PDF + DOCX | M | Depends on 8E lifecycle fields (or gracefully degrade if 8E incomplete) |
| C8 | Report template: **Third-Party Assessment Report** (assessment results for assessor review) — PDF + DOCX | M | |
| C9 | Route `GET /api/export/report?type=...&catalog=...&format=pdf|docx` streaming download | S | |
| C10 | CLI `attesting export report --type <name> --catalog <name> --format pdf|docx --output <path>` | S | |
| C11 | ExportCenter page: add Reports tab with type/format/scope picker | M | |
| C12 | Tests: report generation (buffer output shape), each report type smoke test, CLI, route | M | |

**Depends on:** 8A (for Compliance Summary scoring), 8E (for Evidence Package lifecycle data — soft dep).

### 8D — Continuous Monitoring Dashboard

| # | Task | Complexity | Notes |
|---|---|---|---|
| D1 | Model `src/models/monitoring-dashboard.ts` | S | |
| D2 | Service `src/services/dashboards/monitoring.ts` — composes 6 widgets from drift_alerts, connectors, connector_sync_log, evidence, audit_log, scheduler state, risk history | M | |
| D3 | Expose scheduler state reader — add `getSchedulerState()` to `drift/scheduler.ts` returning next-run timestamps | S | Small refactor to existing scheduler |
| D4 | Route `GET /api/dashboard/monitoring` (+ optional `?since=<ts>` for delta polling) | S | In `src/web/routes/dashboards.ts` |
| D5 | Page `MonitoringDashboard.tsx` + sub-widgets (AlertFeed, ConnectorStatus, CoverageGaps, RecentChanges, SchedulerStatus, RiskMovement) | L | |
| D6 | Auto-refresh hook: 60s polling with toggle + manual refresh button | S | `useInterval` pattern |
| D7 | Router entry `/dashboard/monitoring` + nav link | S | |
| D8 | Tests: route, widgets, auto-refresh behavior | M | |

**Depends on:** nothing hard; looser coupling to 8A (can ship independently).

### 8E — Evidence Lifecycle Management

| # | Task | Complexity | Notes |
|---|---|---|---|
| E1 | Migration `005_evidence_lifecycle.sql` — `ALTER TABLE evidence ADD COLUMN status`, `reviewer_id`, `reviewed_at`, `version`, `previous_version_id`, `renewal_period_days`, `submitted_at`, `approved_at`; CHECK constraint on status enum | S | SQLite ALTER limitations — test carefully |
| E2 | Extend `src/models/evidence.ts` with new fields + `EvidenceStatus` type | S | |
| E3 | Service `src/services/evidence/lifecycle.ts` — state transition functions (`submit`, `review`, `approve`, `reject`, `activate`, `renew`, `archive`) with validation + audit logging | M | |
| E4 | Add `evidence_lifecycle_check` scheduled job to drift scheduler — transitions active → expiring at T-30 days, expiring → expired at T=0, generates drift alerts at 30/60/90 lead times | M | |
| E5 | Extend propagation evidence handler so lifecycle changes trigger scoring recalc (ties into 8A) | S | |
| E6 | Routes: `POST /api/evidence/:id/submit|review|approve|reject|renew|archive` + `GET /api/evidence/queue?owner=` + `GET /api/evidence/:id/versions` | M | Extend `src/web/routes/implementations.ts` or new `src/web/routes/evidence.ts` |
| E7 | CLI: `attesting evidence submit|approve|renew|list-queue` | M | New `src/commands/evidence/` |
| E8 | Evidence lifecycle UI — queue view, review workflow, renewal dialog, version history | L | New `src/web/client/components/evidence/EvidencePage.tsx` |
| E9 | Bulk renewal endpoint + UI action | S | |
| E10 | Tests: state machine (all transitions + invalid transitions rejected), scheduled check, routes, CLI | M | |

**Depends on:** 8A soft dep (lifecycle changes should trigger score recalc via the same propagation handler).

---

## 4. Suggested Sub-Phase Groupings (Execution Order)

Execute **8A first** because everything else either reads from scores (8B, 8C) or should trigger score recalc (8E). 8D can run in parallel with 8C/8E since it's independent. 8E is largest and last because it touches lifecycle state the other phases can gracefully handle as optional.

**Recommended order:**

1. **8A — Scoring Engine** (self-contained foundation)
2. **8B — Executive Dashboard** (consumes 8A output, no schema changes)
3. **8D — Continuous Monitoring** (independent, uses existing data; can be built in parallel with 8B if helpful)
4. **8E — Evidence Lifecycle** (large, adds schema; landed before 8C so Evidence Package report has real data)
5. **8C — Audit Reports** (biggest payoff landing on top of complete 8A + 8E)

Each sub-phase should be a separate prompt in the same style as Phase 4 adapters: tasks numbered, tests required, `npx tsc --noEmit` clean, full test suite green before moving on.

---

## 5. Schema Changes / Migrations

| # | File | Purpose | Sub-phase |
|---|---|---|---|
| 004 | `004_compliance_scores.sql` | `CREATE TABLE compliance_scores` + index on `(catalog_id, scope_id, calculated_at DESC)` | 8A |
| 005 | `005_evidence_lifecycle.sql` | `ALTER TABLE evidence ADD COLUMN ...` × 8 columns + `CREATE INDEX idx_evidence_status` | 8E |

**SQLite notes:**
- Use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` (idempotent for the test-db helper that tolerates duplicate-column errors).
- SQLite can't `ADD COLUMN` with NOT NULL unless default is constant — use `DEFAULT 'active'` for `status`.
- No CHECK constraint changes on existing columns — only new columns get CHECKs.

No other phases require schema changes. 8B, 8C, 8D are pure read-aggregation layers.

---

## 6. Dependencies Between Tasks

```
8A Scoring Engine
 ├── A1 migration
 ├── A2 model ── depends on A1
 ├── A3 service ── depends on A2
 ├── A4 propagation handler ── depends on A3
 ├── A5 dispatcher wiring ── depends on A4
 ├── A6 routes ── depends on A3
 ├── A7 CLI ── depends on A3
 └── A8 tests ── depends on A3–A7

8B Executive Dashboard (needs 8A)
 ├── B1 model ── depends on A3
 ├── B2 service ── depends on B1
 ├── B3 route ── depends on B2
 ├── B4 page + widgets ── depends on B3
 ├── B5 router + nav ── depends on B4
 ├── B6 print CSS ── depends on B4
 └── B7 tests ── depends on B3–B4

8D Continuous Monitoring (independent)
 ├── D1 model
 ├── D2 service
 ├── D3 scheduler state reader ── refactor drift/scheduler.ts
 ├── D4 route ── depends on D2, D3
 ├── D5 page + widgets ── depends on D4
 ├── D6 auto-refresh hook ── depends on D5
 ├── D7 router + nav ── depends on D5
 └── D8 tests ── depends on D4–D5

8E Evidence Lifecycle (needs 8A for scoring integration)
 ├── E1 migration
 ├── E2 model extension ── depends on E1
 ├── E3 lifecycle service ── depends on E2
 ├── E4 scheduled job ── depends on E3 + existing drift scheduler
 ├── E5 propagation integration ── depends on A4 + E3
 ├── E6 routes ── depends on E3
 ├── E7 CLI ── depends on E3
 ├── E8 UI ── depends on E6
 ├── E9 bulk renewal ── depends on E6, E8
 └── E10 tests ── depends on E3–E9

8C Audit Reports (needs 8A + 8E for full data)
 ├── C1 docx base ── independent
 ├── C2 pdf template refactor ── independent
 ├── C3 SSP report ── depends on C1, C2
 ├── C4 POA&M report ── depends on C1, C2
 ├── C5 Risk Assessment report ── depends on C1, C2
 ├── C6 Compliance Summary report ── depends on C1, C2, A3 (scoring)
 ├── C7 Evidence Package report ── depends on C1, C2, E3 (lifecycle)
 ├── C8 Assessment report ── depends on C1, C2
 ├── C9 route ── depends on C3–C8
 ├── C10 CLI ── depends on C3–C8
 ├── C11 UI ── depends on C9
 └── C12 tests ── depends on C3–C11
```

**Critical path:** 8A → 8E → 8C (drives the main sequence). 8B and 8D are parallelizable side branches.

---

## 7. Rough Effort Estimate

| Sub-phase | Tasks | S | M | L | Estimate |
|---|---|---|---|---|---|
| 8A Scoring | 8 | 5 | 3 | 0 | ~1 week |
| 8B Executive Dashboard | 7 | 4 | 2 | 1 | ~1 week |
| 8D Monitoring Dashboard | 8 | 5 | 2 | 1 | ~1 week |
| 8E Evidence Lifecycle | 10 | 3 | 6 | 1 | ~2 weeks |
| 8C Audit Reports | 12 | 2 | 10 | 0 | ~2 weeks |
| **Total** | **45** | **19** | **23** | **3** | **~7 weeks serial, ~5 weeks with 8B/8D parallel** |

---

## 8. Out of Scope for Phase 8

Calling these out so we don't scope-creep:
- Role-based access control on reports/dashboards (Phase 7)
- Real-time websocket push for monitoring dashboard (Phase 9)
- Customer-configurable scoring weights (future)
- Multi-tenant dashboard filtering (Phase 7)
- Scheduled report email delivery (Phase 9 notifications)
- Slack/Teams alert integration (Phase 9)

---

## 9. Ready-to-Start Checklist

Before starting 8A in the next prompt:
- [x] All Phase 4 adapters complete (✅ 441 tests passing)
- [x] Propagation system stable
- [x] Drift scheduler stable
- [x] Phase 8 specs read and summarized
- [x] Migration numbering confirmed (next = 004)
- [x] No conflicting in-flight work on evidence, scoring, or dashboards

**Next action:** Start 8A with a prompt mirroring the Phase 4 adapter style — numbered tasks, tests required, typecheck clean before moving on.
