import type Database from 'better-sqlite3';
import type { Actor } from '../audit/logger.js';
import type { PropagationContext, PropagationEntry } from './types.js';
import { createContext } from './types.js';
import { writeAuditEntry } from '../audit/logger.js';
import { onPolicyContentChange, onPolicySectionChange, onPolicyRetired } from './governance-handlers.js';
import { recalculateRiskForControl } from './risk-handlers.js';
import { onThreatIngested } from './threat-handlers.js';
import { onEvidenceChange } from './evidence-handlers.js';
import { onAssetChange } from './asset-handlers.js';
import { onDispositionApproved } from './disposition-handlers.js';
import { onConnectorStateChange } from './connector-handlers.js';
import {
  recalculateScoreForImplementation,
  recalculateScoreForEvidence,
  recalculateScoreForAssessment,
} from './scoring-handlers.js';

export type EntityType =
  | 'policy' | 'policy_section' | 'implementation'
  | 'evidence' | 'asset' | 'risk' | 'threat_input'
  | 'connector' | 'disposition' | 'assessment';

/**
 * Central dispatcher for all state-change propagation.
 * Every write operation in the platform calls this after committing
 * to trigger downstream drift detection, risk recalculation,
 * and cross-module alerts.
 *
 * Returns the propagation log for tracing.
 */
export function propagate(
  db: Database.Database,
  entityType: EntityType,
  entityId: string,
  action: string,
  actor: Actor,
  prev?: unknown,
  next?: unknown,
): PropagationEntry[] {
  const ctx = createContext(actor);

  const handlers: Record<string, () => void> = {
    policy:          () => handlePolicy(db, ctx, entityId, action, prev, next),
    policy_section:  () => onPolicySectionChange(db, ctx, entityId),
    implementation:  () => handleImplementation(db, ctx, entityId, prev, next),
    evidence:        () => handleEvidence(db, ctx, entityId, prev, next),
    asset:           () => onAssetChange(db, ctx, entityId, prev, next),
    risk:            () => {}, // risk changes don't cascade further currently
    threat_input:    () => onThreatIngested(db, ctx, entityId),
    connector:       () => onConnectorStateChange(db, ctx, entityId, next),
    disposition:     () => handleDisposition(db, ctx, entityId, action, next),
    assessment:      () => recalculateScoreForAssessment(db, ctx, entityId),
  };

  const handler = handlers[entityType];
  if (handler) {
    // Phase 5H — wrap handler so one bad handler doesn't crash the caller.
    // Errors are logged into the propagation context and execution continues.
    try {
      handler();
    } catch (err: any) {
      ctx.log.push({
        type: 'handler_error',
        timestamp: new Date().toISOString(),
        dry_run: ctx.dryRun,
        entity_type: entityType,
        entity_id: entityId,
        action,
        error: err?.message ?? String(err),
        stack: err?.stack,
      });
    }
    // Audit entry still writes even if the handler threw — we want the
    // record of intent regardless of cascade success.
    try {
      writeAuditEntry(db, entityType, entityId, action as any, actor, prev, next);
    } catch (err: any) {
      ctx.log.push({
        type: 'audit_error',
        timestamp: new Date().toISOString(),
        dry_run: ctx.dryRun,
        entity_type: entityType,
        entity_id: entityId,
        error: err?.message ?? String(err),
      });
    }
  }

  return ctx.log;
}

/**
 * Dry-run propagation for shadow impact analysis.
 * Returns what would happen without committing.
 */
export function shadowPropagate(
  db: Database.Database,
  entityType: EntityType,
  entityId: string,
  hypotheticalState: unknown,
): {
  impacts: PropagationEntry[];
  alerts_would_fire: PropagationEntry[];
  risks_affected: PropagationEntry[];
  controls_affected: PropagationEntry[];
  assets_affected: PropagationEntry[];
} {
  const ctx = createContext({ type: 'system', id: 'shadow' }, true);

  const handlers: Record<string, () => void> = {
    threat_input: () => onThreatIngested(db, ctx, entityId),
    policy:       () => onPolicyContentChange(db, ctx, entityId),
  };

  const handler = handlers[entityType];
  if (handler) {
    try {
      handler();
    } catch (err: any) {
      ctx.log.push({
        type: 'handler_error',
        timestamp: new Date().toISOString(),
        dry_run: ctx.dryRun,
        entity_type: entityType,
        entity_id: entityId,
        error: err?.message ?? String(err),
      });
    }
  }

  return {
    impacts: ctx.log,
    alerts_would_fire: ctx.log.filter(e => e.type === 'drift_alert' || e.type.endsWith('_overdue')),
    risks_affected: ctx.log.filter(e => e.type.startsWith('risk_')),
    controls_affected: ctx.log.filter(e => e.type === 'control_stale' || e.type === 'control_gap_threat'),
    assets_affected: ctx.log.filter(e => e.type === 'asset_exposed'),
  };
}

// ── Internal routing helpers ─────────────────────────────────

function handlePolicy(
  db: Database.Database, ctx: PropagationContext,
  policyId: string, action: string, prev: any, next: any,
): void {
  if (action === 'update' && prev?.content_hash !== next?.content_hash) {
    onPolicyContentChange(db, ctx, policyId);
  }
  if (prev?.status === 'active' && (next?.status === 'retired' || next?.status === 'superseded')) {
    onPolicyRetired(db, ctx, policyId);
  }
}

function handleImplementation(
  db: Database.Database, ctx: PropagationContext,
  implId: string, prev: any, next: any,
): void {
  if (prev?.status !== next?.status) {
    // Find the control this implementation addresses
    const impl = db.prepare(
      'SELECT primary_control_id FROM implementations WHERE id = ?'
    ).get(implId) as { primary_control_id: string } | undefined;
    if (impl) {
      recalculateRiskForControl(db, ctx, impl.primary_control_id);
    }
  }
  // Always recompute compliance score (status/statement/responsibility changes
  // can all shift coverage). snapshotScore is cheap (one catalog).
  recalculateScoreForImplementation(db, ctx, implId);
}

function handleEvidence(
  db: Database.Database, ctx: PropagationContext,
  evidenceId: string, prev: any, next: any,
): void {
  onEvidenceChange(db, ctx, evidenceId, prev, next);
  recalculateScoreForEvidence(db, ctx, evidenceId);
}

function handleDisposition(
  db: Database.Database, ctx: PropagationContext,
  dispId: string, action: string, next: any,
): void {
  if (action === 'approve' || next?.approval_status === 'approved') {
    onDispositionApproved(db, ctx, dispId);
  }
}
