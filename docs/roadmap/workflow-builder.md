# 9C · Custom Workflow Builder

**Status:** 💡 Future

## Scope

User-defined if/then automation rules. "When X happens, do Y." Extends the propagation engine with user-configurable rules.

## Examples

- "When a CRITICAL drift alert is created → assign to Security Lead and notify Slack"
- "When evidence expires for a SOC 2 control → create a POA&M item"
- "When a risk score exceeds 20 → escalate to CISO and require exception or treatment plan within 14 days"
- "When a connector sync fails 3 times → disable connector and alert admin"

## Implementation

- **Migration:** `workflows` table (id, name, trigger_type, trigger_filter_json, actions_json, enabled, created_by)
- **Service:** `src/services/workflows/engine.ts` — evaluated after propagation handlers run
- **Actions:** assign_owner, create_task, send_notification, create_risk_exception, update_status, run_cli_command
- **UI:** Visual rule builder — select trigger → configure filter → select action(s)
- **CLI:** `attesting workflow list`, `attesting workflow create`, `attesting workflow enable/disable`

## Guardrails

- Workflows cannot create infinite loops (cycle detection)
- Max 50 workflows per org
- Actions are audited

## Exit Criteria

- [ ] At least 5 trigger types and 5 action types
- [ ] Rules fire correctly during propagation
- [ ] Cycle detection prevents infinite loops
