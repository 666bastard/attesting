# 1C · Drift CLI

**Status:** 📋 Planned
**Depends on:** Drift services (done), disposition services (done), `/api/drift` route (done)
**Pattern:** `src/commands/risk/create.ts`

## Commands

| Command | Description |
|---------|-------------|
| `drift list` | List drift_alerts with filters (type, status, severity, date range). `--json`. |
| `drift check [name]` | Run all 6 drift checks on demand, or a specific check by name. Reports counts. |
| `drift dispose <alert-id>` | Submit natural-language disposition. Runs through NLP pipeline (classify → extract → generate tasks → route approval). |
| `drift tasks` | List auto-generated disposition tasks with status filters. |
| `drift schedule` | Show current scheduler intervals. `--set <check> <interval>` to reconfigure. |

## Files to Create

- `src/commands/drift/index.ts`
- `src/commands/drift/list.ts`
- `src/commands/drift/check.ts`
- `src/commands/drift/dispose.ts`
- `src/commands/drift/tasks.ts`
- `src/commands/drift/schedule.ts`

## Key Details

- `check` calls individual check functions from `src/services/drift/checks.ts` — each returns a count
- `dispose` prompts for rationale text, runs classifier → entity-extractor → task-generator → approval
- High-risk dispositions print "routed to supervisor" status; low-risk print "self-approved"
- `tasks` queries `disposition_tasks` joined to `dispositions` and `drift_alerts`
- `schedule` reads/writes scheduler config (intervals stored in DB or config)

## Exit Criteria

- [ ] `attesting drift --help` shows all 5 subcommands
- [ ] `drift check` runs all 6 checks and reports per-check counts
- [ ] `drift dispose` accepts natural language and shows classification result + generated tasks
