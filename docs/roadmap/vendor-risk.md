# 10C · Vendor Risk Management Module

**Status:** 💡 Future

## Scope

Track third-party vendor risk. Send assessments (SIG questionnaires), collect responses, score vendors, and monitor ongoing risk.

## Features

1. **Vendor registry** — name, category, criticality tier, contract dates, primary contact
2. **Assessment dispatch** — generate SIG questionnaire for vendor, send via email or portal link
3. **Response collection** — vendor fills out questionnaire, responses imported back into Attesting
4. **Vendor scoring** — auto-score based on responses, flag high-risk answers
5. **Ongoing monitoring** — link vendor to connectors for continuous posture checks
6. **Risk linkage** — vendor risks linked to org risks via `risk_controls`

## Implementation

- **Migration:** `vendors` table, `vendor_assessments` table, `vendor_responses` table
- **Service:** `src/services/vendor/assessment.ts`, `src/services/vendor/scoring.ts`
- **Export:** Generate pre-filled SIG questionnaire for vendor (reuses SIG exporter)
- **Import:** Parse completed SIG responses (reuses SIG importer)
- **API:** `/api/vendors`, `/api/vendors/:id/assessments`
- **UI:** Vendor management page with assessment tracking

## Exit Criteria

- [ ] Vendor registry with CRUD
- [ ] SIG questionnaire generated and sent
- [ ] Responses imported and auto-scored
- [ ] Vendor risk linked to organizational risk register
