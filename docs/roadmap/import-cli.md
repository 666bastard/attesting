# 6D · Import CLI Command

**Status:** 🔧 In Progress
**File:** `src/commands/catalog/import-proprietary.ts`
**Scope:** `attesting catalog import-proprietary <file>` with `--format`, `--overwrite`, `--yes` flags. Runs file scanner, shows format detection, displays preview (sample controls + mappings), interactive confirmation prompt, then executes import.
**Key:** Scanner runs before format detection. Preview shows control count, mapping count, sample rows. `--yes` skips confirmation for scripted use.
**Exit:** Full workflow: scan → detect → preview → confirm → import with audit trail.
