# 4A · CrowdStrike Falcon Adapter

**Status:** 📋 Planned
**Pattern:** `src/services/connectors/adapters/cisa-kev.ts`, `src/services/connectors/base-adapter.ts`

## Scope

Pull IOCs, vulnerability data, and detections from CrowdStrike Falcon API. Transform to `threat_inputs`.

## Files to Create

- `src/services/connectors/adapters/crowdstrike.ts` — extends `BaseAdapter`
- `tests/services/connectors/crowdstrike.test.ts`

## Config

```json
{ "client_id": "...", "client_secret": "...", "base_url": "https://api.crowdstrike.com" }
```

## Transform Mapping

| CrowdStrike Field | → threat_inputs Column |
|-------------------|----------------------|
| `indicator.type` + `indicator.value` | `title` |
| `indicator.description` | `description` |
| `indicator.platforms` | `platform` |
| `indicator.severity` | `severity` |
| `indicator.id` | `external_id` |

## Key Details

- OAuth2 client credentials flow for auth (token refresh on 401)
- `fetch(since)` uses `/indicators/queries/iocs/v1` with `modified_on` filter
- Paginate with `offset` + `limit` (max 500 per page)
- After sync, fire `propagate(db, 'connector', id, 'sync', ...)` to trigger threat correlation
- Register in AdapterRegistry with type `'crowdstrike'`

## Exit Criteria

- [ ] Adapter class extends BaseAdapter with `fetch()` and `transform()`
- [ ] Registered in AdapterRegistry
- [ ] Tests cover transform mapping and error handling
- [ ] CLI: `attesting connector add --type crowdstrike --config '{...}'` works
