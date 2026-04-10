# 5B · CLI `--output json` on All Commands

**Status:** 📋 Planned

## Scope

Add `--json` flag to every CLI command that produces output. Enables scripting, piping, and integration with other tools.

## Implementation

- Add `--json` option to every `list`, `inspect`, `status`, and `show` command
- When `--json` is set: suppress formatted output, print `JSON.stringify(data, null, 2)` to stdout
- Errors still go to stderr regardless of output format
- Pipe-friendly: no ANSI colors when `--json` is set or when stdout is not a TTY

## Commands to Update

All commands in: `assessment/`, `catalog/`, `export/`, `implementation/`, `mapping/`, `org/`, `risk/`, `intel/`, `drift/`, `connector/`

## Exit Criteria

- [ ] Every command that produces output supports `--json`
- [ ] `attesting risk list --json | jq '.[] | .risk_id'` works
- [ ] No ANSI escape codes in JSON output
