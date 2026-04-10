# 10B · Gap Analysis Wizard

**Status:** 💡 Future
**Depends on:** Mapping engine (done), coverage calculator (done)

## Scope

Guided wizard that identifies compliance gaps for a target framework. Shows what's covered, what's missing, and generates a prioritized remediation plan.

## Wizard Steps

1. **Select target framework** — choose catalog to assess against
2. **Select scope** — which systems/environments to evaluate
3. **Auto-detect coverage** — engine walks mappings to find implemented controls that satisfy target controls
4. **Gap identification** — controls with no implementation, partial implementation, or stale evidence
5. **Prioritization** — rank gaps by risk score, regulatory impact, and remediation effort
6. **Remediation plan** — generates POA&M items for each gap with suggested owners and timelines

## Implementation

- **Service:** `src/services/analysis/gap-analysis.ts`
- **API:** `POST /api/analysis/gap` (accepts catalog_id, scope_id, returns gap report)
- **CLI:** `attesting analysis gap --catalog cmmc-2.0 --scope production`
- **UI:** Step-by-step wizard component with progress bar

## Key Details

- Leverages transitive mapping resolution — if you implement NIST AC-2, and CMMC maps to AC-2, the gap engine credits CMMC coverage
- Gaps categorized: not_implemented, partially_implemented, evidence_expired, not_assessed
- Remediation plan respects existing risk exceptions (accepted gaps excluded)

## Exit Criteria

- [ ] Wizard identifies all gaps for a target framework
- [ ] Transitive mappings credited correctly
- [ ] POA&M items generated for each gap
