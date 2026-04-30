import { Router } from 'express';
import { db } from '../../db/connection.js';
import { getState, completeStage, skipStage, resetOnboarding, isOnboardingComplete } from '../../services/onboarding/state.js';
import { getRecommendations } from '../../services/onboarding/recommendations.js';
import { seedRisksFromGaps } from '../../services/onboarding/gap-seed.js';
import { importBundledCatalogs, type BundleImportResult } from '../../services/onboarding/catalog-bundle.js';

export function onboardingRoutes(): Router {
  const router = Router();

  /** Get current onboarding state. */
  router.get('/state', (_req, res) => {
    const d = db.getDb();
    res.json(getState(d));
  });

  /** Check if onboarding is complete. */
  router.get('/complete', (_req, res) => {
    const d = db.getDb();
    res.json({ complete: isOnboardingComplete(d) });
  });

  /** Get framework recommendations. */
  router.get('/recommendations', (req, res) => {
    const industry = typeof req.query.industry === 'string' ? req.query.industry : 'other';
    const size = typeof req.query.size === 'string' ? req.query.size : 'small';
    res.json(getRecommendations(industry, size));
  });

  /** Complete a stage. */
  router.post('/complete/:stage', (req, res) => {
    const d = db.getDb();
    const stage = parseInt(req.params.stage, 10);

    let catalogImports: BundleImportResult[] | undefined;
    if (stage === 2 && Array.isArray(req.body?.selected_catalogs)) {
      catalogImports = importBundledCatalogs(d, req.body.selected_catalogs);
    }

    completeStage(d, stage, req.body);
    res.json({ ...getState(d), ...(catalogImports ? { catalog_imports: catalogImports } : {}) });
  });

  /** Skip a stage. */
  router.post('/skip/:stage', (req, res) => {
    const d = db.getDb();
    const stage = parseInt(req.params.stage, 10);
    skipStage(d, stage);
    res.json(getState(d));
  });

  /** Seed risks from gap analysis. */
  router.post('/seed-risks', (req, res) => {
    const d = db.getDb();
    const { catalogs } = req.body;
    const riskIds = seedRisksFromGaps(d, catalogs ?? []);
    res.json({ risk_ids: riskIds, count: riskIds.length });
  });

  /** Reset onboarding. */
  router.post('/reset', (_req, res) => {
    const d = db.getDb();
    resetOnboarding(d);
    res.json({ reset: true });
  });

  return router;
}
