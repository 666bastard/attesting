# 8A · Compliance Score Engine

**Status:** 💡 Future

## Scope

Calculate and track compliance scores per catalog and per scope. Scores reflect implementation coverage, evidence freshness, and assessment results.

## Score Formula

```
score = (implemented_controls / total_controls) × coverage_weight
      + (fresh_evidence / total_evidence) × evidence_weight
      + (passing_assessments / total_assessments) × assessment_weight
```

Default weights: coverage=0.5, evidence=0.3, assessment=0.2. Configurable per org.

## Implementation

- **Service:** `src/services/scoring/compliance-score.ts` — stateless, receives db + catalog_id + scope_id
- **Migration:** `compliance_scores` table (id, catalog_id, scope_id, score, breakdown_json, calculated_at)
- **API:** `GET /api/coverage/:catalogId/score`, `GET /api/coverage/scores` (all catalogs)
- **CLI:** `attesting assessment score --catalog <name> [--scope <name>]`
- **Drift check:** Add score recalculation to the 24hr full posture check

## Breakdown

Score response includes per-control-family breakdown so users can see which areas are strong/weak.

## Trend Tracking

Store historical scores in `compliance_scores` table. API returns trend data (last 30/90/365 days).

## Exit Criteria

- [ ] Score calculated for any catalog/scope combination
- [ ] Breakdown shows per-family scores
- [ ] Historical trend data available
- [ ] Score recalculates automatically on evidence/implementation changes
