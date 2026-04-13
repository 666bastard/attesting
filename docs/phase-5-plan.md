# Phase 5 Plan — Release Hardening

**Status:** Planning · **Date:** 2026-04-13 · **Depends on:** Phases 1–4, 6, 8 complete (603 tests passing)

---

## 1. What Phase 5 Delivers

Phase 5 makes Attesting **publishable to npm + runnable by outside users without Claude-assisted hand-holding**. Seven specs drawn from `docs/roadmap/`:

| Spec | File | Delivers |
|---|---|---|
| **5A** | `docs-readme.md` | README overhaul: hero, quickstart ≤5 min, screenshots, architecture diagram, bundled-catalogs table, CLI reference, API overview |
| **5B** | `cli-json-output.md` | `--json` flag on every output-producing CLI command; ANSI-free JSON payloads suitable for piping |
| **5C** | `openapi-spec.md` | OpenAPI 3.1 spec covering all route groups, Swagger UI at `/api/docs` |
| **5D** | `ci-pipeline.md` | GitHub Actions CI: build, test, lint, catalog-integrity, OSCAL-validate on Node 20/22; badge in README |
| **5E** | `docker.md` | Multi-stage Dockerfile + docker-compose.yml + .dockerignore; image <200MB; volumes for `~/.attesting/` |
| **5F** | `contributing.md` | CONTRIBUTING.md + CODE_OF_CONDUCT.md: dev setup, conventions, feature/connector/catalog guides |
| **5G** | `versioning.md` | SemVer adoption, CHANGELOG.md (Keep a Changelog), tagged releases |

Most artifacts **already exist** from prior work — Phase 5 is closing gaps, fixing robustness issues uncovered by the audit, and running a final polish pass before a release cut.

---

## 2. Audit Findings — What's Already Done vs What's Missing

### ✅ Already In Place
- **README.md** — hero, problem statement, solution, architecture diagram, quickstart. *Missing:* screenshots, full CLI reference tree, API overview.
- **CONTRIBUTING.md** — complete with dev setup, conventions, connector/catalog guides, testing, PR process. **Phase 5F done.**
- **CHANGELOG.md** — Keep a Changelog format, entries through `[0.3.0]`. **Phase 5G done.**
- **LICENSE** — MIT, full text, 2026 copyright.
- **Dockerfile** — multi-stage (builder + runtime), node:20-alpine, volumes, env vars. **Phase 5E done.**
- **.github/workflows/ci.yml + codeql.yml** — build/test/lint pipelines running green. **Phase 5D done.**
- **tsconfig.json** — strict mode, declarations, source maps. Build output → `dist/`.
- **OpenAPI spec** — exists at `src/web/openapi.yaml` (3.0.3). Phase 1–4 routes covered. **Phase 5C ≈60% done.**
- **CLI --json flag** — supported in `risk`, `score`, `monitor`, `evidence`, `report`, `assessment`, `catalog`. Phase 8 commands all consistent.
- **Rate limiting** — global 100 req/60s on `/api/*` in `server.ts`.
- **Input validation** — type-checked query params, safe SQL via prepared statements. **No injection risks.**
- **CLI help text + flag naming** — consistent across all audited groups (`--scope`, `--catalog`, `--json`, `--output`, `--format`).
- **Test suite** — 64 files, 603 tests, 100% pass rate.

### ❌ Gaps Found in Audit

#### Critical (Blockers)
1. **Adapter HTTP timeouts missing** — 0/12 inbound adapters set `AbortSignal.timeout()` on fetch calls. A hung remote endpoint blocks connector syncs indefinitely.
2. **`package.json` missing `"type": "module"`** — package uses ESM imports but this flag is absent. Will cause publish/require issues.
3. **`package.json` missing `files` array** — no control over what ships to npm. Currently would publish everything including `tests/`, `docs/`, etc.

#### Important (Robustness)
4. **Route-layer error wrapping** — most Express route handlers lack `try/catch`. When a service throws, the caller gets a 500 with a raw stack trace instead of `{ error: "..." }`.
5. **Propagation dispatcher doesn't catch handler throws** — `propagate()` calls handlers bare. An exception in any handler bubbles to CLI/route callers. Scheduler is fine (already wraps), but direct callers aren't.
6. **OpenAPI spec stale** — no entries for the 5 Phase 8 route groups (`/api/scores`, `/api/dashboard`, `/api/monitoring`, `/api/evidence`, `/api/reports`) or Phase 4 adapter/connector sync routes.
7. **NVD + Splunk adapters lack 429 retry** — 8/10 network-calling adapters implement Retry-After; two are missing.

#### Polish
8. **README missing CLI reference** — just one example `attesting` command shown. Spec calls for a command tree.
9. **README missing API overview** — no endpoint groups + links to OpenAPI.
10. **README missing screenshots** — dashboard, risk matrix, drift alerts (per spec).
11. **`--json` coverage gaps** — `drift`, `connector`, `intel`, `mapping`, `export`, `implementation` command groups need spot-checks and fixes where missing.
12. **OpenAPI version** — currently 3.0.3, spec calls for 3.1.
13. **No Swagger UI mount** — route `/api/docs` for browsing the spec isn't wired.
14. **CI matrix** — currently single Node version; spec calls for Node 20 + 22.
15. **.dockerignore** — check if present and complete.
16. **CODE_OF_CONDUCT.md** — spec calls for one alongside CONTRIBUTING.md.

---

## 3. Ordered Task List with Complexity

Complexity: **S** = half-day, **M** = 1–2 days, **L** = 3+ days.

### Sub-phase 5H — Robustness Hardening (do first — blockers)

| # | Task | Complexity | Files |
|---|---|---|---|
| H1 | Add `AbortSignal.timeout(30000)` (configurable via `config.timeout_ms`) to every fetch call in 10 network adapters (cisa-kev, nvd, crowdstrike, servicenow, jira, splunk, okta, azure-ad, aws-security-hub, gcp-scc) | M | `src/services/connectors/adapters/*.ts` |
| H2 | Add 429 Retry-After handling to NVD + Splunk adapters to match the others | S | `nvd.ts`, `splunk.ts` |
| H3 | Centralize adapter HTTP helper so timeout/retry/backoff logic lives in one place instead of duplicated 10 times | M | New `src/services/connectors/http.ts` + refactor adapters to use it (keep existing tests green) |
| H4 | Wrap `propagate()` handler invocations in try/catch with a `propagation_error` log entry. Errors inside one handler must not crash the caller or block subsequent handlers | S | `src/services/propagation/dispatcher.ts` |
| H5 | Add Express error-handling middleware that catches thrown exceptions from route handlers and emits `{ error, details? }` with appropriate status codes | S | `src/web/server.ts`, new `src/web/middleware/error-handler.ts` |
| H6 | Wrap async route handlers with an `asyncHandler()` helper so thrown promises route through the error middleware | S | Same middleware file |
| H7 | Tests: adapter timeout triggers correctly, error middleware shapes responses, propagate-catch prevents cascade | M | `tests/services/connectors/http.test.ts`, `tests/web/error-handler.test.ts`, `tests/services/propagation/dispatcher-errors.test.ts` |

**Exit:** typecheck clean, 603+N tests green, no adapter hangs on network timeout test, routes return clean JSON on service errors.

### Sub-phase 5I — Package & Publish Readiness

| # | Task | Complexity | Files |
|---|---|---|---|
| I1 | Add `"type": "module"` to `package.json` + verify all imports still resolve (ESM module resolution) | S | `package.json`; may require `.js` extension audit |
| I2 | Add `"files": ["dist/", "src/db/schema.sql", "src/db/migrations/", "data/", "README.md", "LICENSE", "CHANGELOG.md"]` | S | `package.json` |
| I3 | Verify `bin` shebang (`#!/usr/bin/env node`) is present on compiled `dist/index.js` — add to source if missing, ensure it survives `tsc` | S | `src/index.ts` |
| I4 | Add `prepublishOnly` script that runs build + test | S | `package.json` |
| I5 | Dry-run `npm publish --dry-run` and verify the tarball contains only intended files; add to a release checklist | S | — |
| I6 | Bump version to `0.4.0` and add `[0.4.0]` entry to CHANGELOG covering Phases 4, 8 additions | S | `package.json`, `CHANGELOG.md` |

**Exit:** `npm publish --dry-run` produces a clean tarball under 10MB with only shippable files.

### Sub-phase 5J — OpenAPI & API Docs (5C completion)

| # | Task | Complexity | Files |
|---|---|---|---|
| J1 | Upgrade `openapi.yaml` header to OpenAPI `3.1.0` | S | `src/web/openapi.yaml` |
| J2 | Add path entries for all Phase 4 routes (`/api/connectors/{id}/sync`, `/adapters`, etc.) that were skipped | S | `openapi.yaml` |
| J3 | Add path entries for all Phase 8 routes: `/api/scores/*`, `/api/dashboard/summary`, `/api/monitoring/*`, `/api/evidence/*`, `/api/reports/audit*` | M | `openapi.yaml` |
| J4 | Add schemas for `ComplianceScore`, `FamilyBreakdown`, `DashboardSummary`, `MonitoringThresholds`, `PostureFinding`, `Evidence` (with lifecycle fields), `ReportData` | M | `openapi.yaml` |
| J5 | Mount Swagger UI at `/api/docs` using `swagger-ui-express` + the YAML spec | S | `src/web/server.ts`, `package.json` (new dep) |
| J6 | Route integration test: `GET /api/docs` returns 200 HTML, `GET /api/docs/openapi.yaml` returns the spec | S | `tests/web/openapi.test.ts` |

**Exit:** OpenAPI 3.1 spec complete, Swagger UI browseable locally, all route groups documented.

### Sub-phase 5K — CLI --json Gap Fill (5B completion)

| # | Task | Complexity | Files |
|---|---|---|---|
| K1 | Audit every file under `src/commands/drift/`, `connector/`, `intel/`, `mapping/`, `implementation/`, `export/` for `--json` flag presence | S | — |
| K2 | Add `--json` to any subcommand that produces human output and lacks it; ensure JSON output is free of ANSI codes (use plain `console.log(JSON.stringify(...))`) | M | various `src/commands/**/*.ts` |
| K3 | Document in CONTRIBUTING.md that new CLI commands must support `--json` | S | `CONTRIBUTING.md` |
| K4 | Tests: spot-check a few `--json` outputs parse as valid JSON | S | existing or new CLI tests |

**Exit:** every output-producing CLI subcommand supports `--json`, convention documented.

### Sub-phase 5L — README & Docs Polish (5A completion)

| # | Task | Complexity | Files |
|---|---|---|---|
| L1 | Add CLI reference tree to README — generated or hand-written list of every top-level group with one-line descriptions | S | `README.md` |
| L2 | Add API overview section — endpoint groups linking to OpenAPI spec | S | `README.md` |
| L3 | Add bundled-catalogs table (14 frameworks) from `data/catalogs/` | S | `README.md` |
| L4 | Add badges: CI status, npm version (once published), license, Node version | S | `README.md` |
| L5 | *(Optional)* Screenshots section — defer if the dashboard isn't styled enough to showcase | S | `README.md`, `docs/screenshots/` |
| L6 | Add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) | S | `CODE_OF_CONDUCT.md` |
| L7 | Add `.dockerignore` if missing + verify image excludes `node_modules/`, `tests/`, `.git/`, `docs/` | S | `.dockerignore` |

**Exit:** README reads as a proper project page, code of conduct present.

### Sub-phase 5M — CI Matrix & Release Workflow

| # | Task | Complexity | Files |
|---|---|---|---|
| M1 | Update `.github/workflows/ci.yml` to use a Node matrix (`20.x`, `22.x`) | S | `ci.yml` |
| M2 | Add `catalog-integrity` job that runs `attesting catalog list --json` against seed data | S | `ci.yml` |
| M3 | Add `release.yml` workflow that triggers on `v*` tag push, builds, runs tests, publishes to npm with `NPM_TOKEN` secret | M | `.github/workflows/release.yml` |
| M4 | Add release checklist to `CONTRIBUTING.md` — bump version, update CHANGELOG, tag, push | S | `CONTRIBUTING.md` |
| M5 | *(Optional)* Auto-generate GitHub Release notes from CHANGELOG section | S | `release.yml` |

**Exit:** pushing a `vX.Y.Z` tag cuts a tested release and publishes to npm.

---

## 4. Suggested Sub-Phase Groupings (Execution Order)

Execute **5H first** because timeouts + error middleware unlock everything else — they're cross-cutting and easiest to land before broader code touches. Then 5I so the package is shippable. Then 5J–5M in parallel-friendly order.

**Recommended order:**

1. **5H — Robustness Hardening** (blockers: timeouts, error middleware, propagation safety) — *start here*
2. **5I — Package & Publish Readiness** (module type, files array, version bump) — *fast, unblocks npm*
3. **5J — OpenAPI & API Docs** (spec completion + Swagger UI) — *isolated, no code-path risk*
4. **5K — CLI --json Gap Fill** (broad touch, low risk) — *can run in parallel with 5J*
5. **5L — README & Docs Polish** (final polish pass) — *run late so content reflects final state*
6. **5M — CI Matrix & Release Workflow** (pipeline + release automation) — *last, so initial release cut uses the pipeline*

Each sub-phase is independent enough to be its own prompt in the same style as Phase 4/8: numbered tasks, tests required, `npx tsc --noEmit` clean, full test suite green before advancing.

---

## 5. Breaking Changes & Migration Notes

### Breaking changes expected

- **`"type": "module"` in package.json (5I)** — affects how Node resolves relative imports. All source already uses `.js` extensions so this should be a no-op at runtime, but:
  - Any `require()` calls in tests or scripts need to change to `import`.
  - Need to verify `tsconfig.json` `"module": "NodeNext"` or `"ESNext"` matches.
  - Jest/vitest should already be ESM-aware (vitest is).
- **Error response shape normalization (5H)** — routes that previously leaked stack traces on 500 will now return `{ error: "Internal server error", requestId?: "..." }`. Any consumer that parsed raw stacks must update.

### Non-breaking, additive only

- Timeouts (5H) — configurable with a default; adapters that don't set config.timeout_ms fall through to 30s default.
- OpenAPI entries (5J) — new documentation, no runtime change.
- `--json` additions (5K) — new flag, old flag-less behavior unchanged.
- CI matrix (5M) — new pipeline, no source changes.

### Migration tasks for existing users

- CLI users: none. Command surface is identical + gains `--json` in a few places.
- API users: new error shapes on 500. Update exception handling if clients parse raw text.
- Library users (unlikely this early): recompile against `"type": "module"`; imports must include `.js` extensions (already required in source).

---

## 6. Rough Effort Estimate

| Sub-phase | Tasks | S | M | L | Estimate |
|---|---|---|---|---|---|
| 5H Robustness | 7 | 5 | 2 | 0 | ~1 week |
| 5I Package Readiness | 6 | 6 | 0 | 0 | ~2 days |
| 5J OpenAPI & Docs | 6 | 4 | 2 | 0 | ~4 days |
| 5K CLI --json Fill | 4 | 3 | 1 | 0 | ~2 days |
| 5L README Polish | 7 | 7 | 0 | 0 | ~2 days |
| 5M CI & Release | 5 | 4 | 1 | 0 | ~2 days |
| **Total** | **35** | **29** | **6** | **0** | **~3 weeks serial, ~2 weeks with 5J/5K parallel** |

No Large tasks — this is grinding polish, not architecture.

---

## 7. Out of Scope for Phase 5

Deferred to later phases:
- Role-based access control on API endpoints (Phase 7)
- Authentication/sessions (Phase 7)
- Published screenshots gallery (optional in 5L; defer if UI isn't ready)
- Connector SDK + community adapter template (post-1.0)
- Schema migration versioning tool for live deployments (post-1.0)
- i18n of CLI / API error messages (post-1.0)

---

## 8. Ready-to-Start Checklist

Before starting 5H in the next prompt:
- [x] All Phase 4 adapters complete, tests passing
- [x] Phase 8 sub-phases (A/B/C/D/E) complete, tests passing
- [x] 603 tests green, typecheck clean
- [x] Audit report written (see section 2)
- [x] No in-flight work touching adapters, propagation, or Express middleware
- [x] Existing Dockerfile, CI, CONTRIBUTING, CHANGELOG sufficient baselines to build on

**Next action:** Start **5H — Robustness Hardening** with a prompt mirroring the Phase 4/8 style — numbered tasks from the plan, tests required, `npx tsc --noEmit` clean, full suite green before advancing.

---

## 9. Target Release — v0.4.0

At the end of Phase 5, cut **Attesting v0.4.0** to npm with:
- Complete Phase 1–4, 6, 8 feature set (11 adapters, scoring, dashboards, monitoring, evidence lifecycle, audit reports)
- Hardened network I/O with timeouts + retry
- Clean error responses across API
- OpenAPI 3.1 spec + Swagger UI
- Full `--json` CLI support
- Docker image
- CI matrix (Node 20/22)
- README with CLI/API reference
- Tagged release + auto-publish workflow

This is a **1.0-ready feature set** but still pre-1.0 per the versioning spec (pre-1.0 allows breaking changes in MINOR bumps). Target for **1.0.0:** Phase 7 (auth + RBAC) + one release cycle of external user feedback.
