# Attesting

OSCAL-native GRC platform. Governance, risk, and compliance as a connected entity graph — changes propagate to update risk scores, flag stale controls, and alert owners.

## Stack

TypeScript (strict), Node.js 20+, better-sqlite3 (`~/.attesting/attesting.db`), Commander.js (CLI), Express 5 (API), React 19 / Vite / Tailwind CSS 4 (Web UI), vitest, ESM-only.

## Commands

```bash
npm run build          # tsc
npm run test           # vitest run
npm run test:watch     # vitest watch
npm run dev            # vite dev server (web UI)
npx tsx src/index.ts   # CLI entry point
```

## Repo layout

- `src/commands/` — CLI, one file per command (Commander.js)
- `src/db/` — `connection.ts` (singleton), `schema.sql`, `migrations/`
- `src/models/` — TypeScript interfaces only, no logic
- `src/services/` — stateless business logic: `audit/`, `connectors/`, `disposition/`, `drift/`, `intel/`, `propagation/`
- `src/web/client/` — React frontend: `App.tsx`, `components/`, `hooks/`, `lib/`
- `src/web/routes/` — Express API route files
- `src/exporters/`, `src/importers/`, `src/mappers/`, `src/validators/`, `src/utils/`
- `tests/` — mirrors `src/` structure
- `data/catalogs/`, `data/mappings/`, `data/templates/`

## Code conventions — YOU MUST follow these

- **Files under 300 lines.** Decompose, don't bloat.
- **Models are interfaces only** — no logic in `src/models/`.
- **Services are stateless** — receive `Database` as first arg, never store it.
- **Use `generateUuid()`** from `src/utils/uuid.js` for all primary keys.
- **Use `now()`** from `src/utils/dates.ts` for all timestamps.
- **`.js` extensions in ALL import paths** — ESM requires this. `import { foo } from './bar.js'`, never `'./bar'`.
- **Schema changes go in numbered migration files** in `src/db/migrations/` — NEVER edit `schema.sql`.
- **Migrations use `CREATE TABLE IF NOT EXISTS`** and tolerate `ALTER TABLE` duplicate-column errors.

## Architecture: propagation engine

Central nervous system. Every state change routes through `propagate(db, entityType, entityId, action, actor, prev, next)` in `src/services/propagation/dispatcher.ts`. Domain handlers react to changes (policy→drift alerts, threat→risk creation, evidence expiry→control gaps, etc.). `shadowPropagate()` is dry-run mode.

IMPORTANT: When adding features that create, update, or delete entities that participate in the graph (policies, threats, evidence, assets, risks, dispositions), call `propagate()` after the write.

## Key patterns to follow

When implementing new features, look at existing code first:

| Layer | Pattern file to follow |
|-------|----------------------|
| CLI command | `src/commands/assessment/create.ts` |
| Express route | `src/web/routes/assets.ts` |
| React page | `src/web/client/components/Risk.tsx` |
| Service | `src/services/connectors/adapters/cisa-kev.ts` |
| Connector adapter | `src/services/connectors/base-adapter.ts` |
| Migration | `src/db/migrations/002_grc_extensions.sql` |
| Test | `tests/` — mirror the file under test |

## DB: key relationships

- `implementations.primary_control_id` → `controls.id`
- `policy_controls` links policies ↔ controls
- `risk_controls` links risks ↔ controls
- `dispositions.drift_alert_id` → `drift_alerts.id`
- `threat_asset_correlations` links threats ↔ assets by platform

## Verification

After any code change: run `npm run build` to typecheck, then run relevant tests with `npx vitest run <path>`. Don't run the full suite unless asked.

## When compacting

Preserve: the full list of modified files, current test status, which TODO item is being worked on, and any failing test output.