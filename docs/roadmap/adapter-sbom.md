# 4K · SBOM Ingestion (CycloneDX + SPDX)

**Status:** 📋 Planned · **Pattern:** `src/services/import/parsers.ts` (import pattern) + `base-adapter.ts` (for API-based feeds)

## Scope

Parse Software Bill of Materials files. Create asset entries with component metadata. Link to vulnerability feeds for automated risk correlation.

## Files to Create

- `src/services/connectors/adapters/sbom-cyclonedx.ts` — CycloneDX JSON/XML parser
- `src/services/connectors/adapters/sbom-spdx.ts` — SPDX JSON/tag-value parser
- `src/services/import/sbom-common.ts` — shared component-to-asset mapping logic
- Tests for each

## CycloneDX Transform

| CycloneDX Field | → assets Column |
|-----------------|----------------|
| `components[].name` | `name` |
| `components[].version` | included in `name` |
| `components[].purl` | `external_id` |
| `components[].type` (library, framework, application) | `type` |
| `metadata.component.name` | parent asset reference |

## SPDX Transform

| SPDX Field | → assets Column |
|------------|----------------|
| `packages[].name` | `name` |
| `packages[].versionInfo` | included in `name` |
| `packages[].externalRefs[].referenceLocator` (purl) | `external_id` |
| `packages[].downloadLocation` | `source` |

## Key Details

- Components become assets with platform `software/<type>`
- After import, cross-reference component purls/CPEs against NVD and CISA KEV
- Matching CVEs auto-create `threat_asset_correlations` and generate risks
- Support both file upload (via import route) and API-based feed (via connector)
- Add `.json`, `.xml` to import file scanner for SBOM context (separate from catalog import)

## Exit Criteria

- [ ] CycloneDX JSON parsed → assets created
- [ ] SPDX JSON parsed → assets created
- [ ] Cross-reference against existing threat feeds generates correlations
- [ ] CLI: `attesting catalog import-proprietary sbom.json --format cyclonedx`
- [ ] Tests cover both formats + vulnerability correlation
