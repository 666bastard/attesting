# 9B · Scheduled Report Delivery

**Status:** 💡 Future
**Depends on:** 8C (Audit Reports), 9A (Notifications)

## Scope

Automatically generate and deliver reports on a schedule. Weekly compliance summaries, monthly risk reports, etc.

## Implementation

- **Migration:** `scheduled_reports` table (id, report_type, catalog_id, format, schedule_cron, recipients, last_run, next_run)
- **Service:** `src/services/reports/scheduler.ts` — runs as part of drift scheduler loop
- **Delivery:** Generate report → attach to email via notification engine, or save to configured path
- **CLI:** `attesting report schedule --type compliance-summary --catalog nist-800-53 --cron "0 8 * * 1" --email admin@co.com`

## Report Types

Reuses all report types from 8C: SSP, POA&M, Risk Assessment, Compliance Summary, Evidence Package.

## Exit Criteria

- [ ] Reports generate on schedule
- [ ] Email delivery works with attachment
- [ ] Missed runs catch up on next execution
