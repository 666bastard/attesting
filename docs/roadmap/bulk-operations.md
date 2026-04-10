# 9D · Bulk Operations

**Status:** 💡 Future

## Scope

Mass-assign owners, mass-update statuses, and bulk import/export across entities. Reduces repetitive manual work during assessments and onboarding.

## Operations

1. **Bulk assign owner** — select multiple risks/controls/assets → assign owner
2. **Bulk update status** — select multiple risks/implementations → change status
3. **Bulk link controls** — select multiple risks → link to same control set
4. **Bulk evidence upload** — upload multiple evidence files → auto-match to controls by naming convention
5. **Bulk import risks** — CSV upload with risk register entries
6. **Bulk export** — export filtered entity set as CSV

## Implementation

- **API:** `POST /api/bulk/:entityType` with `{ ids: [...], action: '...', params: {...} }`
- **CLI:** `attesting bulk assign-owner --type risk --filter "status=open" --owner "Security Lead"`
- **UI:** Checkbox column on all tables → bulk action toolbar appears
- **Propagation:** Bulk operations call `propagate()` for each affected entity (batched in transaction)

## Guardrails

- Max 500 entities per bulk operation
- Dry-run mode shows what would change before executing
- All operations logged in audit trail

## Exit Criteria

- [ ] Bulk assign and bulk status update work across all entity types
- [ ] Propagation fires correctly for each entity
- [ ] Audit trail shows individual entries per affected entity
