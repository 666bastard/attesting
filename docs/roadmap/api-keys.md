# 9E · API Key Management

**Status:** 💡 Future
**Depends on:** 7B (Authentication)

## Scope

Allow external systems to authenticate to Attesting's API via API keys. Enables headless integrations, CI/CD pipelines, and third-party tools.

## Implementation

- **Migration:** `api_keys` table (id, key_hash, name, org_id, role_id, scopes_json, last_used, expires_at, created_by, created_at)
- **Key format:** `cwk_` prefix + 32-char random token. Only shown once at creation. Stored as bcrypt hash.
- **Auth middleware:** Check `Authorization: Bearer cwk_...` header, fall back to session auth
- **Scopes:** Optional fine-grained scopes (e.g., `read:risks`, `write:connectors`, `admin`)
- **Rate limiting:** Per-key rate limit (default 100 req/min, configurable)

## CLI

- `attesting api-key create --name "CI Pipeline" --role operator --expires 90d`
- `attesting api-key list`
- `attesting api-key revoke <id>`

## UI

- Settings page: create, list, revoke API keys
- Show last-used timestamp and request count

## Exit Criteria

- [ ] API keys authenticate requests
- [ ] Keys can be scoped to specific permissions
- [ ] Revoked keys immediately stop working
- [ ] Rate limiting enforced per key
