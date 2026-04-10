import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as path from 'path';
import * as fs from 'fs';
import { db } from '../db/connection.js';
import { catalogRoutes } from './routes/catalogs.js';
import { mappingRoutes } from './routes/mappings.js';
import { implementationRoutes } from './routes/implementations.js';
import { coverageRoutes } from './routes/coverage.js';
import { diffRoutes } from './routes/diff.js';
import { exportRoutes } from './routes/export.js';
import { orgRoutes } from './routes/org.js';
import { watchRoutes } from './routes/watches.js';
import { governanceRoutes } from './routes/governance.js';
import { riskRoutes } from './routes/risk.js';
import { intelRoutes } from './routes/intel.js';
import { driftRoutes } from './routes/drift.js';
import { assetRoutes } from './routes/assets.js';
import { connectorRoutes } from './routes/connectors.js';
import { ownerRoutes } from './routes/owners.js';
import { auditRoutes } from './routes/audit.js';
import { importRoutes } from './routes/import.js';
import { onboardingRoutes } from './routes/onboarding.js';

export interface ServerOptions {
  port: number;
  dev?: boolean;
}

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'] }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  // CSP headers
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
    );
    next();
  });

  // Ensure DB is initialized
  db.getDb();

  // API routes
  app.use('/api/org', orgRoutes());
  app.use('/api/catalogs', catalogRoutes());
  app.use('/api/mappings', mappingRoutes());
  app.use('/api/implementations', implementationRoutes());
  app.use('/api/coverage', coverageRoutes());
  app.use('/api/diff', diffRoutes());
  app.use('/api/export', exportRoutes());
  app.use('/api/watches', watchRoutes());
  app.use('/api/governance', governanceRoutes());
  app.use('/api/risk', riskRoutes());
  app.use('/api/intel', intelRoutes());
  app.use('/api/drift', driftRoutes());
  app.use('/api/assets', assetRoutes());
  app.use('/api/connectors', connectorRoutes());
  app.use('/api/owners', ownerRoutes());
  app.use('/api/audit', auditRoutes());
  app.use('/api/import', importRoutes());
  app.use('/api/onboarding', onboardingRoutes());

  // OpenAPI spec
  app.get('/api/docs/openapi.yaml', (_req, res) => {
    const yamlPath = path.join(__dirname, 'openapi.yaml');
    if (fs.existsSync(yamlPath)) {
      res.type('text/yaml').sendFile(yamlPath);
    } else {
      // Fallback: look relative to source
      const srcPath = path.join(__dirname, '../../src/web/openapi.yaml');
      if (fs.existsSync(srcPath)) {
        res.type('text/yaml').sendFile(srcPath);
      } else {
        res.status(404).json({ error: 'OpenAPI spec not found' });
      }
    }
  });

  return app;
}

export function startServer(options: ServerOptions): void {
  const app = createApp();

  // Serve static frontend in production mode
  if (!options.dev) {
    const staticDir = resolveStaticDir();
    if (staticDir && fs.existsSync(staticDir)) {
      app.use(express.static(staticDir));
      // SPA fallback — serve index.html for all non-API routes
      app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(staticDir, 'index.html'));
      });
    }
  }

  app.listen(options.port, () => {
    const mode = options.dev ? 'dev' : 'production';
    console.log(`\x1b[32m✔\x1b[0m Attesting server running at http://localhost:${options.port} (${mode})`);
    if (options.dev) {
      console.log(`  API: http://localhost:${options.port}/api`);
      console.log(`  UI:  Start Vite dev server separately — npx vite --config vite.web.config.ts`);
    }
  });
}

function resolveStaticDir(): string | null {
  const candidates = [
    path.join(__dirname, '../../dist/web'),
    path.join(__dirname, '../../../dist/web'),
    path.join(process.cwd(), 'dist/web'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[2]; // fallback
}
