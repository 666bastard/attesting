import { Router } from 'express';
import { db } from '../../db/connection.js';
import {
  createEvidence,
  getEvidence,
  listEvidence,
  getStateHistory,
  transition,
  classifyFreshness,
  InvalidTransitionError,
} from '../../services/evidence/lifecycle.js';
import { getFreshnessSummary, sweepExpiry } from '../../services/evidence/freshness.js';
import { propagate } from '../../services/propagation/dispatcher.js';
import type { EvidenceAction, EvidenceStatus } from '../../models/evidence.js';
import type { Actor } from '../../services/audit/logger.js';

/**
 * Phase 8E — Evidence lifecycle API.
 *
 *   GET    /api/evidence                          list (filters: status, implementation, expiring)
 *   GET    /api/evidence/freshness                cross-catalog freshness summary
 *   POST   /api/evidence/sweep                    force an expiry sweep run
 *   POST   /api/evidence                          create (draft)
 *   GET    /api/evidence/:id                      detail + history
 *   PUT    /api/evidence/:id                      metadata update
 *   POST   /api/evidence/:id/transition           state machine action
 */
export function evidenceRoutes(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const database = db.getDb();
    const status = typeof req.query.status === 'string' ? req.query.status as EvidenceStatus : undefined;
    const implId = typeof req.query.implementation_id === 'string' ? req.query.implementation_id : undefined;
    const expiringWithin = req.query.expiring_within_days
      ? Number(req.query.expiring_within_days) || undefined
      : undefined;

    const items = listEvidence(database, {
      status,
      implementation_id: implId,
      expiring_within_days: expiringWithin,
    });
    const enriched = items.map((ev) => ({
      ...ev,
      freshness: classifyFreshness(ev),
    }));
    res.json(enriched);
  });

  router.get('/freshness', (_req, res) => {
    const database = db.getDb();
    res.json(getFreshnessSummary(database));
  });

  router.post('/sweep', (_req, res) => {
    const database = db.getDb();
    res.json(sweepExpiry(database));
  });

  router.post('/', (req, res) => {
    const database = db.getDb();
    const body = req.body ?? {};
    if (!body.title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const actor = actorFromReq(req);
    const created = createEvidence(database, body, actor);
    propagate(database, 'evidence', created.id, 'create', actor, undefined, created);
    res.status(201).json(created);
  });

  router.get('/:id', (req, res) => {
    const database = db.getDb();
    const ev = getEvidence(database, req.params.id);
    if (!ev) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }
    res.json({
      ...ev,
      freshness: classifyFreshness(ev),
      history: getStateHistory(database, ev.id),
    });
  });

  router.put('/:id', (req, res) => {
    const database = db.getDb();
    const ev = getEvidence(database, req.params.id);
    if (!ev) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }
    const body = req.body ?? {};
    const allowed = ['title', 'description', 'evidence_type', 'file_path', 'file_hash', 'url',
                     'collected_at', 'collected_by', 'renewal_period_days'];
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const col of allowed) {
      if (body[col] !== undefined) {
        fields.push(`${col} = ?`);
        params.push(body[col]);
      }
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'no updatable fields provided' });
      return;
    }
    database.prepare(`UPDATE evidence SET ${fields.join(', ')} WHERE id = ?`).run(...params, ev.id);
    propagate(database, 'evidence', ev.id, 'update', actorFromReq(req), ev, getEvidence(database, ev.id)!);
    res.json(getEvidence(database, ev.id));
  });

  router.post('/:id/transition', (req, res) => {
    const database = db.getDb();
    const ev = getEvidence(database, req.params.id);
    if (!ev) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }
    const body = req.body ?? {};
    if (!body.action) {
      res.status(400).json({ error: 'action is required' });
      return;
    }
    try {
      const actor = actorFromReq(req);
      const next = transition(database, ev.id, {
        action: body.action as EvidenceAction,
        actor,
        reviewer_id: body.reviewer_id ?? null,
        notes: body.notes,
        renewal_period_days: body.renewal_period_days,
        valid_until_override: body.valid_until,
      });
      propagate(database, 'evidence', ev.id, mapAuditAction(body.action), actor, ev, next);
      res.json(next);
    } catch (err: any) {
      if (err instanceof InvalidTransitionError) {
        res.status(409).json({ error: err.message, from_status: err.fromStatus, action: err.action });
      } else {
        res.status(400).json({ error: err.message });
      }
    }
  });

  return router;
}

function actorFromReq(req: any): Actor {
  const userId = req.headers?.['x-user-id'] ?? 'web';
  return { type: 'user', id: String(userId) };
}

/**
 * Map a lifecycle action name to a CHECK-compliant audit_log action.
 * The audit_log.action column has a fixed enum, so lifecycle verbs like
 * "review"/"submit"/"revise"/"renew" are rolled up under "update".
 */
function mapAuditAction(action: string): string {
  switch (action) {
    case 'accept': return 'approve';
    case 'reject': return 'reject';
    case 'archive': return 'archive';
    default: return 'update';
  }
}
