# Contributing to Attesting

Thanks for your interest. Attesting is an open-source GRC platform in active development and contributions are genuinely welcome — whether that's a new connector adapter, a bug fix, a framework importer, or documentation improvements.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Architecture Principles](#architecture-principles)
- [How to Submit Changes](#how-to-submit-changes)
- [Code Conventions](#code-conventions)
- [Writing a New Connector Adapter](#writing-a-new-connector-adapter)
- [Adding a Framework Catalog](#adding-a-framework-catalog)
- [Adding Cross-Framework Mappings](#adding-cross-framework-mappings)
- [Writing Tests](#writing-tests)
- [What Needs Help](#what-needs-help)
- [What Not to Submit](#what-not-to-submit)

## Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR-USERNAME/attesting.git
cd attesting
npm install

# Run tests
npm test

# Start dev (CLI)
npm run dev -- catalog list

# Start web API (dev mode)
npm run dev -- serve --port 3000 --dev

# Start Vite dev server for the React UI (separate terminal)
npx vite --config vite.web.config.mts

# Type check without emitting
npm run lint

# Build for production
npm run build
```

**Requirements:** Node.js 20+, npm 10+.

**Database location:** `~/.attesting/attesting.db`. Delete this file to start fresh. Schema and migrations apply automatically on first connection.

## Project Structure

```
src/
├── commands/           # CLI commands (Commander.js)
│   ├── assessment/     #   assessment create, evaluate, poam
│   ├── catalog/        #   catalog import, list, inspect, diff, update, watch, impact, refresh
│   ├── export/         #   export sig, oscal, csv, pdf, soa
│   ├── implementation/ #   impl add, import, list, status, edit
│   ├── mapping/        #   mapping create, import, list, resolve, auto-link
│   ├── org/            #   org init, scope create/list
│   └── web/            #   serve
├── db/
│   ├── connection.ts   # DatabaseManager singleton (auto-applies migrations)
│   ├── schema.sql      # Base schema (applied on first run)
│   └── migrations/     # Numbered SQL migration files (applied in order)
├── exporters/          # Output format generators
├── importers/          # Framework catalog parsers
├── mappers/            # Coverage calculation, diff engine, mapping resolver
├── models/             # TypeScript interfaces (one file per entity group)
├── services/           # Business logic (decoupled, focused modules)
│   ├── audit/          #   Immutable audit trail writer
│   ├── connectors/     #   Base adapter, registry, individual adapters
│   ├── disposition/    #   NLP classifier, entity extractor, task generator, approval
│   ├── drift/          #   Alert writer, scheduled checks, scheduler
│   ├── intel/          #   Manual intel lifecycle, shadow analysis, auto-corroboration
│   └── propagation/    #   Dispatcher, per-module handlers, matchers
├── utils/              # Shared utilities (uuid, logger, dates)
├── validators/         # OSCAL validation rules
├── web/
│   ├── client/         # React/Tailwind frontend
│   └── routes/         # Express API routes
└── index.ts            # CLI entry point
```

**Key principle:** files are small and focused. Most service files are 60–200 lines. The largest files in the project are around 300 lines. If a file is approaching 400 lines, it should be decomposed.

## Architecture Principles

These decisions are intentional and should not be changed without an issue discussion first.

**SQLite, local-first.** The database is a single file. No Postgres, no Docker, no server dependencies for basic usage. This is a tool that runs on a compliance analyst's laptop. A Postgres backend is planned for a future multi-tenant SaaS mode, but the local-first SQLite experience must always work.

**OSCAL-native.** The internal data model aligns with NIST OSCAL 1.1.2. Catalogs, controls, implementations, and assessments use OSCAL terminology and structure. Exports produce valid OSCAL JSON. Non-OSCAL formats (SIG, ISO, CMMC) are translated at the import/export boundary, not stored in proprietary schemas.

**CLI-first, web-second.** Every operation must be possible via CLI. The web UI is a convenience layer on top of the same API. CI/CD pipelines should be able to run Attesting commands without a browser.

**Risk module is the hub.** External intelligence flows into the risk module and propagates outward to governance, compliance, and asset inventory. The propagation engine walks the entity graph on every state change. This is the core architectural differentiator — do not decouple the modules into isolated silos.

**Migrations, not schema rewrites.** The base `schema.sql` is applied once on a fresh database. All subsequent schema changes go in numbered files in `src/db/migrations/`. The `DatabaseManager` applies them automatically. Migrations must be idempotent — use `CREATE TABLE IF NOT EXISTS` and handle `ALTER TABLE` errors for duplicate columns gracefully.

**No mega files.** Keep files under 300 lines. If you're writing a service that's approaching 400 lines, split it into focused modules within the same directory. The propagation engine, for example, is 8 files averaging 100 lines each rather than one 800-line monolith.

## How to Submit Changes

1. **Fork** the repository and create a branch from `main`.
2. **Name your branch** descriptively: `feature/crowdstrike-adapter`, `fix/evidence-expiry-check`, `docs/api-reference`.
3. **Write tests** for new functionality. Every service module should have a corresponding test file.
4. **Run the full test suite** before pushing: `npm test`.
5. **Run the type checker**: `npm run lint`.
6. **Submit a PR** with a clear description of what changed and why. Reference any related issues.

For significant architectural changes (new modules, schema redesigns, changing the propagation model), open an issue first to discuss the approach.

## Code Conventions

**Language:** TypeScript strict mode. No `any` except where interfacing with untyped database rows (and even then, cast to a typed interface as soon as possible).

**Formatting:** No Prettier or ESLint config is enforced yet, but follow the existing patterns: 2-space indent, single quotes, semicolons, explicit return types on exported functions.

**Imports:** Use `.js` extensions in import paths (required for ESM + TypeScript). Example: `import { generateUuid } from '../../utils/uuid.js';`

**Database access:** Always go through `db.getDb()` from the singleton in `src/db/connection.ts`. Never construct a `Database` instance directly in application code. Use parameterized queries — never string-interpolate user input into SQL.

**UUIDs:** Use `generateUuid()` from `src/utils/uuid.js` for all primary keys.

**Timestamps:** Use `now()` from `src/utils/dates.ts` for consistency. Store all timestamps as ISO 8601 strings.

**Models:** One file per entity group in `src/models/`. These are TypeScript interfaces only — no class instantiation, no database logic. Keep them aligned with the actual table schema.

**Services:** Business logic lives in `src/services/`, organized by domain (`propagation/`, `drift/`, `intel/`, `disposition/`, `connectors/`). Services are stateless functions or lightweight classes. They receive a `Database` instance as their first argument — they do not import the singleton directly. This makes them testable.

**Routes:** Express route files in `src/web/routes/`. Each file exports a function that returns a `Router`. Follow the existing pattern of `db.getDb()` at the top of each handler.

**CLI commands:** Commander.js command files in `src/commands/<domain>/`. Each file exports a `registerXxx(parent: Command)` function.

## Writing a New Connector Adapter

Connectors are the integration layer between Attesting and external systems. To add one:

1. Create a new file at `src/services/connectors/adapters/your-adapter.ts`.
2. Extend `BaseAdapter` from `src/services/connectors/base-adapter.ts`.
3. Implement `fetch(since: string | null): Promise<any[]>` — fetches records from the external system.
4. Implement `transform(record: any): { _table: string; external_id: string; ... }` — transforms an external record into an Attesting entity. The `_table` field tells the base class which table to upsert into.
5. For bidirectional adapters, also implement `push(entity: any): Promise<any>`.
6. Register your adapter in `src/services/connectors/registry.ts`.
7. Write tests.

Example structure:

```typescript
import { BaseAdapter } from '../base-adapter.js';

export class MyAdapter extends BaseAdapter {
  async fetch(since: string | null): Promise<any[]> {
    // Call external API, return array of raw records
  }

  transform(record: any) {
    return {
      _table: 'assets',  // or 'threat_inputs', etc.
      external_id: record.id,
      name: record.hostname,
      asset_type: 'server',
      platform: record.os,
      // ...other fields matching the target table
    };
  }
}
```

The base class handles: sync logging, upsert logic (insert or update by `external_source` + `external_id`), health tracking, error accumulation, and connector status updates. You just implement the fetch and transform.

## Adding a Framework Catalog

If you're adding support for a new compliance framework:

1. Obtain the catalog data in OSCAL JSON, CSV, or another structured format. **Do not commit copyrighted control text** — only structural metadata (control IDs, family names, mapping references).
2. If the format is OSCAL JSON, use the existing `attesting catalog import --format oscal` command.
3. If the format is CSV, use `attesting catalog import --format csv` with appropriate column mappings.
4. If the format requires a custom parser, add an importer in `src/importers/`.
5. Place any seed data (structural metadata only) in `data/catalogs/`.
6. Add the framework to the "Bundled Catalogs" table in the README.

## Adding Cross-Framework Mappings

If you're contributing control mappings between frameworks:

- Each mapping must specify a **relationship type**: `equivalent`, `subset`, `superset`, `related`, or `intersects`.
- Each mapping must specify a **confidence level**: `high`, `medium`, or `low`.
- Include a **source** citation (e.g., "SIG Content Library ISO 27001:2022 column", "NIST SP 800-53 to 800-171 mapping published by NIST").
- Mappings should be verified by someone with domain expertise in both frameworks.
- Place mapping CSVs in `data/mappings/` with the naming pattern `source-to-target.csv`.

## Writing Tests

Tests use [vitest](https://vitest.dev/) and live in `tests/`, mirroring the `src/` structure.

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/services/propagation/matchers.test.ts

# Watch mode
npm run test:watch
```

**Testing services:** Services receive a `Database` instance, so tests can use an in-memory SQLite database (`new Database(':memory:')`) with the schema applied. No mocking frameworks needed — just pass a real (in-memory) database.

**Testing adapters:** Mock the external API calls. Test the `transform()` logic with real sample data.

**Testing CLI commands:** Use the existing patterns in `tests/commands/` — these test the command output via process execution.

## What Needs Help

Roughly in priority order:

**Connector adapters** — CrowdStrike (asset inventory), ServiceNow ITSM (bidirectional ticketing), Splunk/Elastic (SIEM evidence), Okta/Entra ID (identity), cloud providers (AWS/Azure/GCP asset discovery). NVD, CISA KEV, and SBOM (CycloneDX/SPDX) are done.

**Framework importers** — FedRAMP profile resolver (automatically resolve 800-53 baselines), additional OSCAL catalog sources.

**Documentation** — API reference (OpenAPI spec), architecture deep-dive, deployment guide, framework-specific walkthroughs.

**Onboarding wizard** — Guided first-run experience for CLI and Web UI. See `docs/roadmap/onboarding-wizard.md`.

## What Not to Submit

- **Copyrighted framework content.** No SIG question text, ISO 27001 requirement text, or any other proprietary content. Control IDs and structural metadata only.
- **Organization-specific data.** No customer names, internal policies, or real compliance data. Use generic examples.
- **Dependencies on external services for basic functionality.** The core platform must work offline with SQLite. External integrations are additive, not required.
- **Mega files.** If your PR adds a file over 300 lines, explain why it can't be decomposed — or decompose it.
- **Changes to core architecture** without prior discussion in an issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.