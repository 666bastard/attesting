# Attesting

OSCAL-native GRC platform, v0.4.0. Governance, risk, and compliance as a connected entity graph — changes propagate to update risk scores, flag stale controls, score compliance, and alert owners.

## Stack

TypeScript (strict, ESM, `"type": "module"`, `moduleResolution: NodeNext`), Node.js 20+, better-sqlite3 (`~/.attesting/attesting.db`), Commander.js (CLI), Express 5 with `asyncHandler` + `errorHandler` middleware (API), Swagger UI served at `/api/docs` from an in-code OpenAPI 3.1 spec, React 19 / Vite / Tailwind CSS 4 (Web UI), vitest, pdfkit + docx (audit reports), exceljs (Excel I/O).

## Commands

```bash
npm run build          # tsc → dist/
npm run lint           # tsc --noEmit
npm run test           # vitest run
npm run test:watch     # vitest watch
npx vite build --config vite.web.config.mts   # frontend → dist/client/
npx tsx src/index.ts   # CLI entry point (dev)
node dist/index.js     # compiled CLI
```

## Repo layout

- `src/commands/` — CLI, one file per command (Commander.js). Groups: `assessment/`, `catalog/`, `connector/`, `drift/`, `evidence/`, `export/`, `implementation/`, `intel/`, `mapping/`, `monitor/`, `org/`, `report/`, `risk/`, `score/`, `setup/`, `web/`
- `src/db/` — `connection.ts` (singleton, applies migrations), `schema.sql`, `migrations/` (006 and counting)
- `src/models/` — TypeScript interfaces only, no logic
- `src/services/` — stateless business logic:
  - `audit/`, `connectors/` (+ `adapters/`, `utils/fetch-with-timeout.ts`, `utils/aws-sigv4.ts`, `utils/gcp-auth.ts`), `disposition/`, `drift/`, `evidence/` (lifecycle + freshness), `intel/`, `monitoring/` (posture monitor + thresholds), `onboarding/`, `propagation/` (dispatcher + handlers), `reports/` (audit report aggregator), `scoring/` (compliance scoring engine)
- `src/web/client/` — React frontend: `App.tsx`, `components/`, `hooks/`, `lib/`
- `src/web/middleware/` — `error-handler.ts`, `async-handler.ts`
- `src/web/routes/` — Express API route files (23 files, all namespaces under `/api/*`)
- `src/web/openapi.ts` + `src/web/openapi-paths.ts` — OpenAPI 3.1 spec builder
- `src/exporters/` — CSV, OSCAL, SIG, SOA, PDF audit report, DOCX audit report
- `src/importers/`, `src/mappers/`, `src/validators/`, `src/utils/`
- `tests/` — mirrors `src/` structure
- `data/catalogs/`, `data/mappings/`, `data/templates/`

Build output splits: `dist/` holds tsc output (backend), `dist/client/` holds vite output (frontend). These must not overlap — vite uses `emptyOutDir: true`.

## Code conventions — YOU MUST follow these

- **Files under 300 lines.** Decompose, don't bloat.
- **Models are interfaces only** — no logic in `src/models/`.
- **Services are stateless** — receive `Database` as first arg, never store it.
- **Use `generateUuid()`** from `src/utils/uuid.js` for all primary keys.
- **Use `now()`** from `src/utils/dates.ts` for all timestamps.
- **`.js` extensions in ALL import paths** — ESM requires this. `import { foo } from './bar.js'`, never `'./bar'`.
- **No `__dirname` without the shim** — ESM scope has no `__dirname`; use `const __dirname = path.dirname(fileURLToPath(import.meta.url));`. See `src/db/connection.ts` or `src/web/server.ts` for the pattern. This applies to `scripts/*.ts` too.
- **Schema changes go in numbered migration files** in `src/db/migrations/` — NEVER edit `schema.sql`.
- **Migrations use `CREATE TABLE IF NOT EXISTS`** and tolerate `ALTER TABLE` duplicate-column errors.
- **Every async Express route handler must be wrapped with `asyncHandler()`** from `src/web/middleware/async-handler.ts` — Express 5 has limited native promise-rejection routing, and handler errors must flow through the global `errorHandler`.
- **Route error responses must use typed errors** from `src/web/middleware/error-handler.ts`: `HttpError`, `badRequest()`, `notFound()`, `conflict()`. Never leak raw stack traces or un-shaped JSON. Global middleware emits `{ error, code, status, details?, stack? }` with prod stack suppression.
- **All adapter HTTP calls must use `fetchWithTimeout()`** from `src/services/connectors/utils/fetch-with-timeout.ts` — pass `this.timeoutMs()` (inherited from `BaseAdapter`) and an `adapter: 'MyAdapter'` label so timeouts surface with context. Default 30s.
- **Adapter constructors must validate required config fields** — fail fast at construction, never silently at first sync. Tests cover this via `expect(() => new X(db, id, {})).toThrow(...)`.
- **Every CLI data-query/mutate command must support `--json`.** Emit via `console.log(JSON.stringify(data, null, 2))` and early-return before human-readable output. The meta-test `tests/commands/json-flag-coverage.test.ts` walks the full commander tree and fails if any non-exempt leaf lacks `--json`. Exempt: `setup`, `serve`, `export csv|oscal|sig|soa|pdf`.
- **OpenAPI spec must be kept in sync** with route changes — `src/web/openapi-paths.ts` holds the per-route path definitions, `src/web/openapi.ts` holds shared component schemas. Tests in `tests/web/openapi.test.ts` assert every mounted namespace is documented; adding a new route without a spec entry will fail the namespace lockstep test.

## Change discipline — YOU MUST follow these

- **Touch only what the task requires.** Do not "improve" adjacent code, comments, or formatting. Do not refactor neighboring functions. Do not rename things that are not explicitly in scope.
- **Orphaned code.** If your changes leave an import, variable, or helper unused, remove it in the same change. Do NOT remove pre-existing dead code unless the task explicitly asks.
- **Ambiguity.** If the requested change is ambiguous, surface 2–3 specific interpretations as a choice, not an open question. If you must proceed without confirmation, state the assumption explicitly in your response.
- **Simpler paths.** If a simpler approach exists than the one requested, propose it before building the complex one. Do not silently substitute your preference.
- **Define success upfront.** For non-trivial tasks, state the explicit verification criterion before starting (e.g., "main has all changes + CI green + zero open alerts"). Loop against that criterion, not against a gut feeling of "done."
- **Every diff line justifies itself.** A reviewer should be able to trace every changed line back to the request. If they can't, delete it.

## Architecture: propagation engine

Central nervous system. Every state change routes through `propagate(db, entityType, entityId, action, actor, prev, next)` in `src/services/propagation/dispatcher.ts`. Domain handlers react to changes (policy→drift alerts, threat→risk creation, evidence expiry→control gaps, implementation change→score recalc, etc.). `shadowPropagate()` is dry-run mode.

Phase 5H made the dispatcher safe: handler throws are caught per-handler, logged into the propagation context as `{ type: 'handler_error', ... }`, and execution continues to the next handler. One bad handler no longer crashes the caller.

IMPORTANT: When adding features that create, update, or delete entities that participate in the graph (policies, threats, evidence, assets, risks, dispositions, implementations, assessments), call `propagate()` after the write. The scoring handler auto-recomputes compliance scores on implementation/evidence/assessment changes.

## Key patterns to follow

When implementing new features, look at existing code first:

| Layer | Pattern file to follow |
|---|---|
| CLI command | `src/commands/score/show.ts` or `src/commands/evidence/index.ts` |
| Express route | `src/web/routes/evidence.ts` (uses asyncHandler + HttpError) |
| React page | `src/web/client/components/dashboard/Dashboard.tsx` |
| Service | `src/services/scoring/compliance-score.ts` (stateless, db-first-arg) |
| Connector adapter | `src/services/connectors/adapters/cisa-kev.ts` (simplest) or `aws-security-hub.ts` (full SigV4) |
| Adapter base class | `src/services/connectors/base-adapter.ts` |
| Error middleware | `src/web/middleware/error-handler.ts` |
| Async route wrapper | `src/web/middleware/async-handler.ts` |
| OpenAPI paths | `src/web/openapi-paths.ts` |
| Scoring engine | `src/services/scoring/compliance-score.ts` |
| Evidence lifecycle | `src/services/evidence/lifecycle.ts` |
| Continuous monitoring | `src/services/monitoring/posture-monitor.ts` |
| Report aggregator | `src/services/reports/aggregate.ts` |
| PDF generator | `src/exporters/pdf-audit-report.ts` |
| DOCX generator | `src/exporters/docx-audit-report.ts` |
| Migration | `src/db/migrations/004_compliance_scores.sql` or `006_evidence_lifecycle.sql` |
| Test | `tests/` — mirror the file under test |

## DB: key relationships

- `implementations.primary_control_id` → `controls.id`
- `policy_controls` links policies ↔ controls
- `risk_controls` links risks ↔ controls
- `dispositions.drift_alert_id` → `drift_alerts.id`
- `threat_asset_correlations` links threats ↔ assets by platform
- `compliance_scores` — one row per (scope_id, catalog_id), current snapshot
- `compliance_score_history` — append-only time-series for trend queries
- `monitoring_thresholds` — layered config (exact → scope-only → catalog-only → global) for posture monitor
- `evidence_state_history` — audit trail of every lifecycle transition
- `connector_sync_log` — append-only per-sync results with stats and errors

## What's TODO

- **Phase 7 — Auth, RBAC, multi-tenancy.** Production blocker for any hosted deployment. Audit log infrastructure already exists; routes and middleware currently run without authentication.
- **Phase 9 — Automation & notifications.** Webhook dispatcher, scheduled report delivery, Slack/Teams integration, notification engine for drift alerts and posture-monitor findings, API key management for external callers.
- **Phase 6 — Proprietary framework import** beyond what already ships (SIG, ISO 27001 via exceljs). FedRAMP profile resolver, CCM, additional sector-specific catalogs.
- **Phase 10 — Advanced platform.** Control inheritance, gap analysis, vendor risk management, policy management workflow, training tracking, incident response.
- **Additional connector adapters.** The 11 built-in adapters (CISA KEV, NVD, SBOM CycloneDX/SPDX, CrowdStrike, ServiceNow, Jira, Splunk, Okta, Azure AD, AWS Security Hub, GCP SCC) cover the most common sources. Still wanted: Elastic, Tenable, Qualys, Snyk, Wiz, HashiCorp Vault, GitHub Advanced Security, Microsoft Defender for Cloud.
- **OpenAPI response schemas.** The spec covers all 77 paths with tags and summaries, but per-field response components are generic for many endpoints. Flesh out.

## Verification

After any code change: run `npm run build` to typecheck, then run relevant tests with `npx vitest run <path>`. Don't run the full suite unless asked.

## When compacting

Preserve: the full list of modified files, current test status, which TODO item is being worked on, and any failing test output.
