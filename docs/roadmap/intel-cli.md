# 1B · Intel CLI

**Status:** 📋 Planned
**Depends on:** Intel services (done), `/api/intel` route (done)
**Pattern:** `src/commands/risk/create.ts`

## Commands

| Command | Description |
|---------|-------------|
| `intel list` | List threat_inputs with filters (source, platform, date range, status). `--json`. |
| `intel submit` | Submit manual intel as provisional. Triggers `generateShadowImpact()`. Prints shadow analysis. |
| `intel promote <id>` | Promote provisional → confirmed. Calls `promoteManualIntel()` → full propagation. |
| `intel corroborate` | Run `checkAutoCorroboration()` on demand against all provisional intel. |
| `intel shadow <id>` | Display shadow impact analysis for a specific intel entry without promoting. |

## Files to Create

- `src/commands/intel/index.ts`
- `src/commands/intel/list.ts`
- `src/commands/intel/submit.ts`
- `src/commands/intel/promote.ts`
- `src/commands/intel/corroborate.ts`
- `src/commands/intel/shadow.ts`

## Files to Modify

- `src/index.ts` — register `registerIntelCommands(program)`

## Key Details

- `submit` creates `manual_intel` row with `status: 'provisional'`, then calls `generateShadowImpact()`
- `promote` calls `promoteManualIntel()` which converts to `threat_input` and triggers `propagate()`
- `corroborate` iterates all provisional intel and runs `checkAutoCorroboration()` — reports matches
- `shadow` calls `shadowPropagate()` and formats the impact preview (alerts, risks, controls, assets affected)
- All commands use `--json` flag for scriptable output

## Exit Criteria

- [ ] `attesting intel --help` shows all 5 subcommands
- [ ] Full workflow: submit provisional → view shadow → corroborate → promote
- [ ] Shadow output shows affected risks, controls, and assets
