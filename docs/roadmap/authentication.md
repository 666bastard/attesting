# 7B · Authentication (Local + SSO/SAML)

**Status:** 💡 Future
**Depends on:** 7A (RBAC) — ship together or auth first

## Scope

User authentication with local credentials and optional SSO/SAML for enterprise environments.

## Local Auth

- **Migration:** `users` table (id, email, password_hash, display_name, status, created_at, last_login)
- Password hashing with bcrypt (cost factor 12)
- Session management via signed HTTP-only cookies (express-session + better-sqlite3 session store)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- CLI: `attesting user create --email <email> --role <role>`

## SSO/SAML (Phase 2)

- SAML 2.0 via `passport-saml`
- Configuration: IdP metadata URL, entity ID, callback URL stored in org settings
- Just-in-time user provisioning on first SSO login
- Role mapping from SAML attributes to Attesting roles

## Session Security

- CSRF protection via double-submit cookie
- Session expiry: 8 hours idle, 24 hours absolute
- Rate limiting on login endpoint (5 attempts per minute)

## Exit Criteria

- [ ] Local login/logout works
- [ ] Sessions persist across page refreshes
- [ ] Unauthenticated API requests return 401
- [ ] SSO login flow works with a test IdP
