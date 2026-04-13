import type Database from 'better-sqlite3';
import { generateUuid } from '../../utils/uuid.js';
import { now } from '../../utils/dates.js';
import type { Actor } from '../audit/logger.js';
import {
  ALLOWED_TRANSITIONS,
  ACTION_RESULT,
  DEFAULT_EXPIRY_LEAD_DAYS,
  type Evidence,
  type EvidenceAction,
  type EvidenceStatus,
  type EvidenceFreshness,
  type EvidenceStateHistoryEntry,
} from '../../models/evidence.js';

/**
 * Phase 8E — Evidence lifecycle state machine + persistence.
 *
 * All transitions go through transition(). Invalid actions throw with a
 * clear message. Each transition appends a row to evidence_state_history
 * for audit provenance. Acceptance actions compute valid_from/valid_until
 * from renewal_period_days.
 */

export class InvalidTransitionError extends Error {
  constructor(public fromStatus: EvidenceStatus, public action: EvidenceAction) {
    super(`Cannot ${action} evidence in status "${fromStatus}"`);
    this.name = 'InvalidTransitionError';
  }
}

// ── Pure state-machine helpers ─────────────────────────────

export function isTransitionAllowed(from: EvidenceStatus, action: EvidenceAction): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(action) ?? false;
}

export function resultingStatus(action: EvidenceAction): EvidenceStatus {
  return ACTION_RESULT[action];
}

/** Classify an evidence row into a freshness bucket for reporting. */
export function classifyFreshness(
  ev: Pick<Evidence, 'status' | 'valid_until'>,
  leadDays = DEFAULT_EXPIRY_LEAD_DAYS,
  nowTs: number = Date.now(),
): EvidenceFreshness {
  if (ev.status === 'archived') return 'archived';
  if (ev.status === 'rejected') return 'rejected';
  if (ev.status === 'expired') return 'expired';
  if (ev.status === 'draft' || ev.status === 'submitted' || ev.status === 'reviewed') return 'pending';

  const until = ev.valid_until ? new Date(ev.valid_until).getTime() : null;
  if (until === null) return 'fresh'; // accepted without expiry = fresh
  if (until < nowTs) return 'expired';
  if (until - nowTs <= leadDays * 24 * 60 * 60 * 1000) return 'expiring_soon';
  return 'fresh';
}

// ── CRUD ───────────────────────────────────────────────────

export interface CreateEvidenceInput {
  implementation_id?: string | null;
  assessment_result_id?: string | null;
  title: string;
  description?: string;
  evidence_type?: Evidence['evidence_type'];
  file_path?: string;
  file_hash?: string;
  url?: string;
  collected_at?: string;
  collected_by?: string;
  renewal_period_days?: number | null;
  previous_version_id?: string | null;
}

export function createEvidence(
  db: Database.Database,
  input: CreateEvidenceInput,
  actor: Actor,
): Evidence {
  const id = generateUuid();
  const ts = now();

  let version = 1;
  if (input.previous_version_id) {
    const prev = db.prepare('SELECT version FROM evidence WHERE id = ?').get(input.previous_version_id) as
      | { version: number } | undefined;
    if (prev) version = (prev.version ?? 1) + 1;
  }

  db.prepare(`
    INSERT INTO evidence (
      id, implementation_id, assessment_result_id, title, description,
      evidence_type, file_path, file_hash, url, collected_at, collected_by,
      created_at, status, renewal_period_days, version, previous_version_id,
      last_state_change_at, state_changed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(
    id,
    input.implementation_id ?? null,
    input.assessment_result_id ?? null,
    input.title,
    input.description ?? null,
    input.evidence_type ?? 'document',
    input.file_path ?? null,
    input.file_hash ?? null,
    input.url ?? null,
    input.collected_at ?? null,
    input.collected_by ?? null,
    ts,
    input.renewal_period_days ?? null,
    version,
    input.previous_version_id ?? null,
    ts,
    actor.id ?? null,
  );

  writeHistory(db, id, null, 'draft', actor, null, 'Evidence created');
  return getEvidence(db, id)!;
}

export function getEvidence(db: Database.Database, id: string): Evidence | null {
  const row = db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as any | undefined;
  return row ? hydrate(row) : null;
}

export function listEvidence(
  db: Database.Database,
  filters: { status?: EvidenceStatus; implementation_id?: string; expiring_within_days?: number } = {},
): Evidence[] {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.implementation_id) {
    where.push('implementation_id = ?');
    params.push(filters.implementation_id);
  }
  if (filters.expiring_within_days !== undefined) {
    const cutoff = new Date(Date.now() + filters.expiring_within_days * 86400_000).toISOString();
    where.push('valid_until IS NOT NULL AND valid_until <= ?');
    params.push(cutoff);
  }

  const rows = db.prepare(
    `SELECT * FROM evidence WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
  ).all(...params) as any[];
  return rows.map(hydrate);
}

export function getStateHistory(db: Database.Database, evidenceId: string): EvidenceStateHistoryEntry[] {
  return db.prepare(
    'SELECT * FROM evidence_state_history WHERE evidence_id = ? ORDER BY changed_at ASC, rowid ASC',
  ).all(evidenceId) as EvidenceStateHistoryEntry[];
}

// ── Transitions ────────────────────────────────────────────

export interface TransitionInput {
  action: EvidenceAction;
  actor: Actor;
  reviewer_id?: string | null;
  notes?: string;
  renewal_period_days?: number | null;
  valid_until_override?: string | null;
}

export function transition(
  db: Database.Database,
  evidenceId: string,
  input: TransitionInput,
): Evidence {
  const ev = getEvidence(db, evidenceId);
  if (!ev) throw new Error(`Evidence not found: ${evidenceId}`);

  if (!isTransitionAllowed(ev.status, input.action)) {
    throw new InvalidTransitionError(ev.status, input.action);
  }

  // Review/accept/reject require a reviewer
  if ((input.action === 'review' || input.action === 'accept' || input.action === 'reject')
      && !input.reviewer_id) {
    throw new Error(`${input.action} requires a reviewer_id`);
  }

  const next = resultingStatus(input.action);
  const ts = now();

  const updates: string[] = ['status = ?', 'last_state_change_at = ?', 'state_changed_by = ?'];
  const params: unknown[] = [next, ts, input.actor.id ?? null];

  if (input.reviewer_id !== undefined) {
    updates.push('reviewer_id = ?'); params.push(input.reviewer_id);
  }
  if (input.notes !== undefined) {
    updates.push('review_notes = ?'); params.push(input.notes);
  }
  if (input.action === 'review' || input.action === 'accept' || input.action === 'reject') {
    updates.push('reviewed_at = ?'); params.push(ts);
  }
  if (input.action === 'renew' && input.renewal_period_days !== undefined) {
    updates.push('renewal_period_days = ?');
    params.push(input.renewal_period_days);
  }

  // On accept (or renew), set validity window
  if (input.action === 'accept' || input.action === 'renew') {
    const days = input.renewal_period_days ?? ev.renewal_period_days;
    updates.push('valid_from = ?'); params.push(ts);
    if (input.valid_until_override) {
      updates.push('valid_until = ?'); params.push(input.valid_until_override);
    } else if (days && days > 0) {
      const until = new Date(Date.now() + days * 86400_000).toISOString();
      updates.push('valid_until = ?'); params.push(until);
    }
  }

  db.prepare(`UPDATE evidence SET ${updates.join(', ')} WHERE id = ?`).run(...params, evidenceId);
  writeHistory(db, evidenceId, ev.status, next, input.actor, input.reviewer_id ?? null, input.notes ?? null);

  return getEvidence(db, evidenceId)!;
}

/** System-initiated transition (e.g. by the drift scheduler). */
export function systemTransition(
  db: Database.Database,
  evidenceId: string,
  toStatus: EvidenceStatus,
  reason: string,
): void {
  const ts = now();
  const prev = (db.prepare('SELECT status FROM evidence WHERE id = ?').get(evidenceId) as
    | { status: EvidenceStatus } | undefined)?.status ?? null;
  db.prepare(`
    UPDATE evidence SET status = ?, last_state_change_at = ?, state_changed_by = 'system'
    WHERE id = ?
  `).run(toStatus, ts, evidenceId);
  writeHistory(db, evidenceId, prev, toStatus, { type: 'system', id: 'scheduler' }, null, reason);
}

// ── Internals ──────────────────────────────────────────────

function writeHistory(
  db: Database.Database,
  evidenceId: string,
  from: EvidenceStatus | null,
  to: EvidenceStatus,
  actor: Actor,
  reviewerId: string | null,
  notes: string | null,
): void {
  db.prepare(`
    INSERT INTO evidence_state_history
      (id, evidence_id, from_status, to_status, actor_type, actor_id, reviewer_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(generateUuid(), evidenceId, from, to, actor.type, actor.id ?? null, reviewerId, notes);
}

function hydrate(row: any): Evidence {
  return {
    id: row.id,
    implementation_id: row.implementation_id ?? undefined,
    assessment_result_id: row.assessment_result_id ?? undefined,
    title: row.title,
    description: row.description ?? undefined,
    evidence_type: row.evidence_type,
    file_path: row.file_path ?? undefined,
    file_hash: row.file_hash ?? undefined,
    url: row.url ?? undefined,
    collected_at: row.collected_at ?? undefined,
    collected_by: row.collected_by ?? undefined,
    created_at: row.created_at,
    status: (row.status ?? 'draft') as EvidenceStatus,
    reviewer_id: row.reviewer_id ?? null,
    reviewed_at: row.reviewed_at ?? null,
    review_notes: row.review_notes ?? null,
    valid_from: row.valid_from ?? null,
    valid_until: row.valid_until ?? null,
    renewal_period_days: row.renewal_period_days ?? null,
    version: row.version ?? 1,
    previous_version_id: row.previous_version_id ?? null,
    last_state_change_at: row.last_state_change_at ?? null,
    state_changed_by: row.state_changed_by ?? null,
  };
}
