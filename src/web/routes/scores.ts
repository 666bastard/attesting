import { Router } from 'express';
import { db } from '../../db/connection.js';
import {
  snapshotScore,
  getLatestScore,
  getScoresForScope,
  getScoreHistory,
} from '../../services/scoring/snapshot.js';
import { calculateScore } from '../../services/scoring/compliance-score.js';

/**
 * Phase 8A — Compliance score API.
 *
 *   GET  /api/scores/:scopeRef/:catalogRef           current score + breakdown
 *   GET  /api/scores/:scopeRef/:catalogRef/history   score trend over time
 *   POST /api/scores/:scopeRef/:catalogRef/snapshot  force a manual recompute
 *   GET  /api/scores/:scopeRef/summary               all catalogs for one scope
 *
 * `scopeRef` accepts either a scope UUID, a scope name, or the literal `org`
 * for an org-wide score (scope_id = NULL).
 */
export function scoresRoutes(): Router {
  const router = Router();

  router.get('/:scopeRef/summary', (req, res) => {
    const database = db.getDb();
    const scopeId = resolveScope(database, req.params.scopeRef);
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${req.params.scopeRef}" not found` });
      return;
    }
    const computeIfMissing = req.query.compute === 'true';
    let scores = getScoresForScope(database, scopeId);
    if (scores.length === 0 && computeIfMissing) {
      scores = snapshotAllCatalogs(database, scopeId);
    }
    res.json({
      scope_ref: req.params.scopeRef,
      scope_id: scopeId,
      catalogs: scores,
    });
  });

  router.get('/:scopeRef/:catalogRef', (req, res) => {
    const database = db.getDb();
    const scopeId = resolveScope(database, req.params.scopeRef);
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${req.params.scopeRef}" not found` });
      return;
    }
    const catalogId = resolveCatalog(database, req.params.catalogRef);
    if (!catalogId) {
      res.status(404).json({ error: `Catalog "${req.params.catalogRef}" not found` });
      return;
    }

    let score = getLatestScore(database, catalogId, scopeId);
    if (!score) {
      // No snapshot yet — compute on the fly without persisting
      const computed = calculateScore(database, catalogId, scopeId);
      res.json({ persisted: false, ...computed });
      return;
    }
    res.json({ persisted: true, ...score });
  });

  router.get('/:scopeRef/:catalogRef/history', (req, res) => {
    const database = db.getDb();
    const scopeId = resolveScope(database, req.params.scopeRef);
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${req.params.scopeRef}" not found` });
      return;
    }
    const catalogId = resolveCatalog(database, req.params.catalogRef);
    if (!catalogId) {
      res.status(404).json({ error: `Catalog "${req.params.catalogRef}" not found` });
      return;
    }
    const sinceDays = parsePositiveInt(req.query.days, 90);
    const entries = getScoreHistory(database, catalogId, scopeId, sinceDays);
    res.json({
      scope_id: scopeId,
      catalog_id: catalogId,
      since_days: sinceDays,
      entries,
    });
  });

  router.post('/:scopeRef/:catalogRef/snapshot', (req, res) => {
    const database = db.getDb();
    const scopeId = resolveScope(database, req.params.scopeRef);
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${req.params.scopeRef}" not found` });
      return;
    }
    const catalogId = resolveCatalog(database, req.params.catalogRef);
    if (!catalogId) {
      res.status(404).json({ error: `Catalog "${req.params.catalogRef}" not found` });
      return;
    }
    const snap = snapshotScore(database, catalogId, scopeId, { trigger: 'manual' });
    res.json(snap);
  });

  return router;
}

// ── helpers ───────────────────────────────────────────────

/**
 * Resolve a scope reference to a scope_id.
 * Returns `null` for the literal "org" (org-wide), a string for a real scope,
 * or `undefined` when the reference doesn't match anything.
 */
function resolveScope(database: any, scopeRef: string): string | null | undefined {
  if (!scopeRef || scopeRef === 'org' || scopeRef === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(scopeRef) as
    | { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(scopeRef) as
    | { id: string } | undefined;
  if (byName) return byName.id;
  return undefined;
}

/** Resolve a catalog reference (UUID or short_name) to a catalog_id. */
function resolveCatalog(database: any, catalogRef: string): string | null {
  const row = database.prepare(
    'SELECT id FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1',
  ).get(catalogRef, catalogRef) as { id: string } | undefined;
  return row?.id ?? null;
}

function snapshotAllCatalogs(database: any, scopeId: string | null) {
  const catalogs = database.prepare('SELECT id FROM catalogs').all() as Array<{ id: string }>;
  return catalogs.map((c) =>
    snapshotScore(database, c.id, scopeId, { trigger: 'manual' }),
  );
}

function parsePositiveInt(v: any, def: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}
