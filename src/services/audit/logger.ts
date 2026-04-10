import type Database from 'better-sqlite3';
import { generateUuid } from '../../utils/uuid.js';

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'approve' | 'reject'
  | 'promote' | 'archive' | 'suppress' | 'resolve' | 'escalate'
  | 'sync' | 'correlate' | 'propagate';

export type ActorType = 'user' | 'system' | 'connector' | 'nlp';

export interface Actor {
  type: ActorType;
  id: string;
}

/**
 * Writes immutable audit log entries for every state change in the platform.
 * Every service calls this after committing a mutation.
 */
export function writeAuditEntry(
  db: Database.Database,
  entityType: string,
  entityId: string,
  action: AuditAction,
  actor: Actor,
  previousState?: unknown,
  newState?: unknown,
  summary?: string,
): void {
  db.prepare(`
    INSERT INTO audit_log (id, entity_type, entity_id, action, actor_type, actor_id,
                           previous_state, new_state, change_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateUuid(),
    entityType,
    entityId,
    action,
    actor.type,
    actor.id,
    previousState ? JSON.stringify(previousState) : null,
    newState ? JSON.stringify(newState) : null,
    summary ?? `${action} on ${entityType}:${entityId}`,
  );
}

/** System actor constant for automated actions. */
export const SYSTEM_ACTOR: Actor = { type: 'system', id: 'attesting' };
