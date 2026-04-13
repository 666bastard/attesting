/**
 * Evidence row shapes — Phase 8E extends this with full lifecycle tracking.
 */

export type EvidenceStatus =
  | 'draft'
  | 'submitted'
  | 'reviewed'
  | 'accepted'
  | 'rejected'
  | 'expiring'
  | 'expired'
  | 'archived';

export type EvidenceAction =
  | 'submit'
  | 'review'
  | 'accept'
  | 'reject'
  | 'revise'
  | 'renew'
  | 'archive';

export type EvidenceFreshness = 'fresh' | 'expiring_soon' | 'expired' | 'pending' | 'rejected' | 'archived';

export interface Evidence {
  id: string;
  implementation_id?: string;
  assessment_result_id?: string;
  title: string;
  description?: string;
  evidence_type:
    | 'document'
    | 'screenshot'
    | 'log'
    | 'policy'
    | 'interview'
    | 'observation';
  file_path?: string;
  file_hash?: string;
  url?: string;
  collected_at?: string;
  collected_by?: string;
  created_at: string;

  // Phase 8E lifecycle fields
  status: EvidenceStatus;
  reviewer_id?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  renewal_period_days?: number | null;
  version: number;
  previous_version_id?: string | null;
  last_state_change_at?: string | null;
  state_changed_by?: string | null;
}

export interface EvidenceStateHistoryEntry {
  id: string;
  evidence_id: string;
  from_status: EvidenceStatus | null;
  to_status: EvidenceStatus;
  actor_type: string;
  actor_id: string | null;
  reviewer_id: string | null;
  notes: string | null;
  changed_at: string;
}

/** POA&M row (unchanged from original schema). */
export interface PoamItem {
  id: string;
  org_id: string;
  assessment_result_id?: string;
  control_id: string;
  poam_id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  finding: string;
  current_state?: string;
  required_action: string;
  responsible?: string;
  support?: string;
  target_date?: string;
  actual_completion_date?: string;
  status: 'not-started' | 'in-progress' | 'completed' | 'overdue' | 'deferred';
  notes?: string;
  created_at: string;
  updated_at: string;
}

/** Default renewal reminder lead time in days. */
export const DEFAULT_EXPIRY_LEAD_DAYS = 30;

/** State machine: which actions are allowed from each state. */
export const ALLOWED_TRANSITIONS: Record<EvidenceStatus, EvidenceAction[]> = {
  draft:     ['submit', 'archive'],
  submitted: ['review', 'archive'],
  reviewed:  ['accept', 'reject', 'archive'],
  rejected:  ['revise', 'archive'],
  accepted:  ['renew', 'archive'],
  expiring:  ['accept', 'renew', 'archive'],
  expired:   ['renew', 'archive'],
  archived:  [],
};

/** Which status results from applying an action. */
export const ACTION_RESULT: Record<EvidenceAction, EvidenceStatus> = {
  submit:  'submitted',
  review:  'reviewed',
  accept:  'accepted',
  reject:  'rejected',
  revise:  'draft',
  renew:   'accepted',
  archive: 'archived',
};
