# 8C · Audit-Ready Report Generator

**Status:** 💡 Future
**Depends on:** 8A (Compliance Scoring), existing exporters

## Scope

Generate professional PDF and DOCX reports suitable for auditors, regulators, and board presentations.

## Report Types

1. **System Security Plan (SSP)** — full implementation narrative per control family
2. **Plan of Action & Milestones (POA&M)** — open items with timelines and owners
3. **Risk Assessment Report** — risk register with matrix, treatment plans, exceptions
4. **Compliance Summary** — per-framework score with control-level detail
5. **Evidence Package** — index of all evidence with freshness status
6. **Third-Party Assessment Report** — assessment results formatted for assessor review

## Implementation

- Extend existing `src/exporters/pdf-report.ts` with report templates
- Add DOCX export using `docx` npm package
- Template system: header/footer with org branding, table of contents, page numbers
- Data pulled from existing services — no new data collection

## API

- `GET /api/export/report?type=ssp&catalog=...&format=pdf`
- `GET /api/export/report?type=poam&format=docx`

## CLI

- `attesting export report --type ssp --catalog nist-800-53 --format pdf --output ./reports/`

## Exit Criteria

- [ ] All 6 report types generate in PDF and DOCX
- [ ] Reports include table of contents, page numbers, org branding
- [ ] POA&M report accepted by an actual assessor (manual validation)
