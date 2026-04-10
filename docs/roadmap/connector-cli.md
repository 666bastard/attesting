# 1D · Connector CLI

**Status:** 📋 Planned
**Depends on:** Connector services (done), AdapterRegistry (done), `/api/connectors` route (done)
**Pattern:** `src/commands/risk/create.ts`

## Commands

| Command | Description |
|---------|-------------|
| `connector list` | List registered connectors with health status, last sync time, record counts. |
| `connector add` | Register a new connector. `--type <adapter-type> --config <json-or-file>`. |
| `connector sync [id]` | Trigger sync for a specific connector or all connectors. Shows progress + results. |
| `connector log [id]` | Show sync history from `connector_sync_log`. Filterable by date, status. |
| `connector health [id]` | Check adapter health (connectivity, auth, API availability). |

## Files to Create

- `src/commands/connector/index.ts`
- `src/commands/connector/list.ts`
- `src/commands/connector/add.ts`
- `src/commands/connector/sync.ts`
- `src/commands/connector/log.ts`
- `src/commands/connector/health.ts`

## Key Details

- `add` validates adapter type exists in AdapterRegistry before creating DB row
- `sync` calls adapter's `fetch(since)` → `transform()` → upsert, logs to `connector_sync_log`
- `sync` fires `propagate(db, 'connector', id, 'sync', ...)` after successful sync
- `health` calls adapter's connectivity check and reports status
- `log` shows last N syncs with record counts, errors, duration

## Exit Criteria

- [ ] `attesting connector --help` shows all 5 subcommands
- [ ] Can register CISA KEV connector, sync it, and view the log
- [ ] Health check reports connectivity status
