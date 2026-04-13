import { Command } from 'commander';
import { db } from '../../db/connection.js';
import { info, log, success, warn, error } from '../../utils/logger.js';
import {
  createEvidence,
  getEvidence,
  listEvidence,
  getStateHistory,
  transition,
  classifyFreshness,
  InvalidTransitionError,
} from '../../services/evidence/lifecycle.js';
import { getFreshnessSummary } from '../../services/evidence/freshness.js';
import { propagate } from '../../services/propagation/dispatcher.js';
import type { EvidenceAction, EvidenceStatus } from '../../models/evidence.js';
import type { Actor } from '../../services/audit/logger.js';

const CLI_ACTOR: Actor = { type: 'user', id: 'cli' };

/** Roll lifecycle verbs into CHECK-compliant audit_log action values. */
function mapAuditAction(action: string): string {
  switch (action) {
    case 'accept': return 'approve';
    case 'reject': return 'reject';
    case 'archive': return 'archive';
    default: return 'update';
  }
}

/** Registers the `attesting evidence` command group. */
export function registerEvidenceCommands(program: Command): void {
  const cmd = program
    .command('evidence')
    .description('Manage evidence artifacts through their lifecycle');

  registerList(cmd);
  registerShow(cmd);
  registerCreate(cmd);
  registerTransition(cmd);
  registerFreshness(cmd);
}

// ── evidence list ─────────────────────────────────────────

function registerList(parent: Command): void {
  parent
    .command('list')
    .description('List evidence artifacts with optional filters')
    .option('--status <status>', 'Filter by status')
    .option('--implementation <id>', 'Filter by implementation ID')
    .option('--expiring-within <days>', 'Show only items expiring within N days', (v) => parseInt(v, 10))
    .option('--json', 'Output as JSON')
    .action((opts: { status?: string; implementation?: string; expiringWithin?: number; json?: boolean }) => {
      const database = db.getDb();
      const items = listEvidence(database, {
        status: opts.status as EvidenceStatus | undefined,
        implementation_id: opts.implementation,
        expiring_within_days: opts.expiringWithin,
      });
      const enriched = items.map((ev) => ({ ...ev, freshness: classifyFreshness(ev) }));

      if (opts.json) {
        console.log(JSON.stringify(enriched, null, 2));
        return;
      }
      if (enriched.length === 0) { warn('No evidence found.'); return; }
      info(`${enriched.length} evidence item(s):`);
      for (const ev of enriched) {
        log(
          `  ${ev.id.substring(0, 8)}  ${ev.status.padEnd(10)} ${ev.freshness.padEnd(14)}` +
          `  v${ev.version}  ${ev.title}`,
        );
      }
    });
}

// ── evidence show ─────────────────────────────────────────

function registerShow(parent: Command): void {
  parent
    .command('show')
    .description('Show evidence detail + state history')
    .requiredOption('--id <id>', 'Evidence UUID')
    .option('--json', 'Output as JSON')
    .action((opts: { id: string; json?: boolean }) => {
      const database = db.getDb();
      const ev = getEvidence(database, opts.id);
      if (!ev) { error(`Evidence not found: ${opts.id}`); process.exit(1); }
      const history = getStateHistory(database, ev.id);
      const freshness = classifyFreshness(ev);

      if (opts.json) {
        console.log(JSON.stringify({ ...ev, freshness, history }, null, 2));
        return;
      }
      info(`Evidence ${ev.id}`);
      log(`  Title:        ${ev.title}`);
      log(`  Status:       ${ev.status}  (${freshness})`);
      log(`  Version:      ${ev.version}`);
      log(`  Collected:    ${ev.collected_at ?? '—'}  by ${ev.collected_by ?? '—'}`);
      log(`  Valid:        ${ev.valid_from ?? '—'} → ${ev.valid_until ?? '—'}`);
      log(`  Reviewer:     ${ev.reviewer_id ?? '—'}  reviewed ${ev.reviewed_at ?? '—'}`);
      if (ev.review_notes) log(`  Review notes: ${ev.review_notes}`);
      log('');
      log(`  History (${history.length}):`);
      for (const h of history) {
        log(`    ${h.changed_at}  ${h.from_status ?? '∅'} → ${h.to_status}  by ${h.actor_type}:${h.actor_id ?? '—'}  ${h.notes ?? ''}`);
      }
    });
}

// ── evidence create ───────────────────────────────────────

function registerCreate(parent: Command): void {
  parent
    .command('create')
    .description('Create a new evidence artifact (starts in draft)')
    .requiredOption('--title <title>', 'Evidence title')
    .option('--description <text>', 'Description')
    .option('--implementation <id>', 'Implementation ID to link')
    .option('--type <type>', 'document, screenshot, log, policy, interview, observation', 'document')
    .option('--file <path>', 'File path')
    .option('--url <url>', 'External URL')
    .option('--renewal-days <n>', 'Renewal period in days', (v) => parseInt(v, 10))
    .option('--json', 'Output as JSON')
    .action((opts: any) => {
      const database = db.getDb();
      const ev = createEvidence(database, {
        title: opts.title,
        description: opts.description,
        implementation_id: opts.implementation,
        evidence_type: opts.type,
        file_path: opts.file,
        url: opts.url,
        renewal_period_days: opts.renewalDays,
      }, CLI_ACTOR);
      propagate(database, 'evidence', ev.id, 'create', CLI_ACTOR, undefined, ev);

      if (opts.json) { console.log(JSON.stringify(ev, null, 2)); return; }
      success(`Evidence created: ${ev.id}`);
      log(`  Title:  ${ev.title}`);
      log(`  Status: ${ev.status}`);
    });
}

// ── evidence transition ───────────────────────────────────

function registerTransition(parent: Command): void {
  parent
    .command('transition')
    .description('Apply a lifecycle transition (submit/review/accept/reject/revise/renew/archive)')
    .requiredOption('--id <id>', 'Evidence UUID')
    .requiredOption('--action <action>', 'submit | review | accept | reject | revise | renew | archive')
    .option('--reviewer <id>', 'Reviewer identifier (required for review/accept/reject)')
    .option('--notes <text>', 'Notes / justification')
    .option('--renewal-days <n>', 'New renewal period (for renew action)', (v) => parseInt(v, 10))
    .option('--valid-until <iso>', 'Explicit valid_until override')
    .option('--json', 'Output as JSON')
    .action((opts: any) => {
      const database = db.getDb();
      const ev = getEvidence(database, opts.id);
      if (!ev) { error(`Evidence not found: ${opts.id}`); process.exit(1); }
      try {
        const next = transition(database, ev.id, {
          action: opts.action as EvidenceAction,
          actor: CLI_ACTOR,
          reviewer_id: opts.reviewer ?? null,
          notes: opts.notes,
          renewal_period_days: opts.renewalDays,
          valid_until_override: opts.validUntil,
        });
        propagate(database, 'evidence', ev.id, mapAuditAction(opts.action), CLI_ACTOR, ev, next);

        if (opts.json) { console.log(JSON.stringify(next, null, 2)); return; }
        success(`Evidence transitioned: ${ev.status} → ${next.status}`);
        if (next.valid_until) log(`  Valid until:  ${next.valid_until}`);
      } catch (err: any) {
        if (err instanceof InvalidTransitionError) {
          error(`Invalid transition: ${err.message}`);
        } else {
          error(err.message);
        }
        process.exit(1);
      }
    });
}

// ── evidence freshness ────────────────────────────────────

function registerFreshness(parent: Command): void {
  parent
    .command('freshness')
    .description('Report on evidence freshness across all catalogs')
    .option('--json', 'Output as JSON')
    .action((opts: { json?: boolean }) => {
      const database = db.getDb();
      const report = getFreshnessSummary(database);
      if (opts.json) { console.log(JSON.stringify(report, null, 2)); return; }

      info(`Evidence freshness — ${report.generated_at}`);
      log('');
      log('  Overall:');
      log(`    fresh          ${report.overall.fresh}`);
      log(`    expiring soon  ${report.overall.expiring_soon}`);
      log(`    expired        ${report.overall.expired}`);
      log(`    pending review ${report.overall.pending}`);
      log(`    rejected       ${report.overall.rejected}`);
      log(`    archived       ${report.overall.archived}`);
      log('');
      for (const c of report.by_catalog) {
        log(
          `  ${c.catalog_short_name.padEnd(20)} ` +
          `fresh=${c.fresh} expiring=${c.expiring_soon} expired=${c.expired} ` +
          `pending=${c.pending} · controls ${c.controls_with_evidence}/${c.total_controls}`,
        );
      }
    });
}
