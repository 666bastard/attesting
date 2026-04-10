# 1A · Risk CLI

**Status:** 🔧 In Progress
**Depends on:** Services + API routes (done)
**Pattern:** `src/commands/assessment/create.ts`

## Commands

| Command | Description |
|---------|-------------|
| `risk list` | List risks with filters (status, category, owner, source_type, above-appetite). `--json` output. |
| `risk create` | Create risk with auto-generated RISK-xxx ID. Requires title, owner, likelihood, impact. Calls `propagate()`. |
| `risk update <ref>` | Update by RISK-xxx or UUID. Recomputes inherent/residual scores. Calls `propagate()`. |
| `risk link <ref>` | Link risk to controls (`--controls`) and/or assets (`--assets`). Validates existence. |
| `risk exceptions` | Subcommands: `list` (filterable), `create` (with risk/control validation), `revoke`. |
| `risk matrix` | View or configure the 5×5 matrix. Renders grid in terminal with risk distribution. |

## Files to Create

- `src/commands/risk/index.ts` — registers all subcommands on `risk` parent
- `src/commands/risk/list.ts`
- `src/commands/risk/create.ts`
- `src/commands/risk/update.ts`
- `src/commands/risk/link.ts`
- `src/commands/risk/exceptions.ts`
- `src/commands/risk/matrix.ts`

## Files to Modify

- `src/index.ts` — import and register `registerRiskCommands(program)`

## Key Details

- `create` and `update` call `propagate(db, 'risk', id, action, actor, prev, next)`
- `link` uses `INSERT OR IGNORE` into `risk_controls` and `risk_asset_links`
- `list --above-appetite` queries against `risk_matrix.appetite_threshold`
- `exceptions create` validates risk and optional control existence before insert
- `matrix` auto-creates default matrix if none exists

## Exit Criteria

- [ ] `attesting risk --help` shows all 6 subcommands
- [ ] `attesting risk list` returns results (or empty)
- [ ] Full workflow: create → link controls → update score → create exception → view matrix
- [ ] `npm run build` passes
