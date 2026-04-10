# 7C · Multi-Org Tenancy

**Status:** 💡 Future
**Depends on:** 7A (RBAC), 7B (Authentication)

## Scope

Support multiple organizations in a single Attesting instance. Each org has isolated data (catalogs, risks, assets, etc.) while sharing the platform.

## Approach

Row-level isolation via `org_id` foreign key on all entity tables. Not separate databases.

## Implementation

- **Migration:** Add `org_id` column to all tables that don't already have it (controls, implementations, risks, assets, threat_inputs, drift_alerts, etc.)
- **Middleware:** `injectOrg()` middleware resolves org from authenticated user's session, adds to `req.org`
- **Query scoping:** All queries append `WHERE org_id = ?` — encapsulate in a helper: `scopedQuery(db, orgId, table, ...)`
- **CLI:** `attesting org switch <org-name>` to change active org context
- **Super-admin role:** Can see all orgs, manage cross-org settings

## Data Isolation Verification

- Integration test: create data in org A, verify org B cannot see it
- Audit log entries include org_id

## Exit Criteria

- [ ] Two orgs can coexist with fully isolated data
- [ ] Switching orgs changes all visible data
- [ ] No cross-org data leakage in any route
