# 7A · RBAC (Role-Based Access Control)

**Status:** 💡 Future

## Scope

Add roles, permissions, and route guards. Users can only access/modify data their role permits.

## Roles

| Role | Description |
|------|-------------|
| `admin` | Full access. Manage users, roles, org settings. |
| `analyst` | Read/write risks, intel, drift, dispositions. Cannot manage users or org. |
| `auditor` | Read-only access to everything. Can export reports. |
| `operator` | Manage connectors, run syncs, view assets. Limited risk/intel access. |
| `viewer` | Read-only access to dashboards and reports only. |

## Implementation

- **Migration:** `roles` table (id, name, permissions JSON), `user_roles` junction
- **Middleware:** `requireRole(...roles)` Express middleware on every route
- **CLI:** `attesting user create`, `attesting user assign-role`
- **UI:** Role badge in header, disabled controls for unauthorized actions
- **Audit:** All permission checks logged

## Dependencies

- 7B (Authentication) should ship with or before RBAC

## Exit Criteria

- [ ] Routes guarded by role
- [ ] Unauthorized access returns 403
- [ ] Admin can assign/revoke roles
