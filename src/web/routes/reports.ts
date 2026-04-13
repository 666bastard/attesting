import { Router } from 'express';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { db } from '../../db/connection.js';
import { aggregateReportData } from '../../services/reports/aggregate.js';
import { renderAuditReportPdf } from '../../exporters/pdf-audit-report.js';
import { renderAuditReportDocx } from '../../exporters/docx-audit-report.js';

/**
 * Phase 8C — Audit report API.
 *
 *   GET  /api/reports/audit/preview?scope=&catalog=     report JSON preview
 *   GET  /api/reports/audit?scope=&catalog=&format=pdf  download PDF
 *   GET  /api/reports/audit?scope=&catalog=&format=docx download DOCX
 */
export function reportsRoutes(): Router {
  const router = Router();

  router.get('/audit/preview', (req, res) => {
    const database = db.getDb();
    const scopeId = resolveScope(database, queryString(req, 'scope'));
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${req.query.scope}" not found` });
      return;
    }
    const catalogRef = queryString(req, 'catalog');
    if (!catalogRef) {
      res.status(400).json({ error: 'catalog query parameter is required' });
      return;
    }
    const catalogId = resolveCatalog(database, catalogRef);
    if (!catalogId) {
      res.status(404).json({ error: `Catalog "${catalogRef}" not found` });
      return;
    }
    const trendDays = parsePositiveInt(req.query.trend_days, 90);
    const data = aggregateReportData(database, { scope_id: scopeId, catalog_id: catalogId, trend_days: trendDays });
    res.json(data);
  });

  router.get('/audit', async (req, res) => {
    const database = db.getDb();
    const scopeId = resolveScope(database, queryString(req, 'scope'));
    if (scopeId === undefined) {
      res.status(404).json({ error: `Scope "${req.query.scope}" not found` });
      return;
    }
    const catalogRef = queryString(req, 'catalog');
    if (!catalogRef) {
      res.status(400).json({ error: 'catalog query parameter is required' });
      return;
    }
    const catalogId = resolveCatalog(database, catalogRef);
    if (!catalogId) {
      res.status(404).json({ error: `Catalog "${catalogRef}" not found` });
      return;
    }
    const format = (queryString(req, 'format') ?? 'pdf').toLowerCase();
    if (format !== 'pdf' && format !== 'docx') {
      res.status(400).json({ error: `format must be pdf or docx (got "${format}")` });
      return;
    }

    const trendDays = parsePositiveInt(req.query.trend_days, 90);
    const data = aggregateReportData(database, { scope_id: scopeId, catalog_id: catalogId, trend_days: trendDays });

    const dir = path.join(os.homedir(), '.attesting', 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeScope = (data.scope.name || 'org').replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${data.catalog.short_name}-${safeScope}-${ts}.${format}`;
    const outputPath = path.join(dir, filename);

    try {
      let buffer: Buffer;
      let contentType: string;
      if (format === 'pdf') {
        const result = await renderAuditReportPdf(data, outputPath);
        buffer = fs.readFileSync(result.path);
        contentType = 'application/pdf';
      } else {
        const result = await renderAuditReportDocx(data, outputPath);
        buffer = fs.readFileSync(result.path);
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.end(buffer);
    } catch (err: any) {
      res.status(500).json({ error: 'Report generation failed', details: err.message });
    }
  });

  return router;
}

function queryString(req: any, key: string): string | undefined {
  const v = req.query?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function resolveScope(database: any, ref: string | undefined): string | null | undefined {
  if (!ref || ref === 'org' || ref === '__org__') return null;
  const byId = database.prepare('SELECT id FROM scopes WHERE id = ?').get(ref) as { id: string } | undefined;
  if (byId) return byId.id;
  const byName = database.prepare('SELECT id FROM scopes WHERE name = ?').get(ref) as { id: string } | undefined;
  if (byName) return byName.id;
  return undefined;
}

function resolveCatalog(database: any, ref: string): string | null {
  const row = database
    .prepare('SELECT id FROM catalogs WHERE id = ? OR short_name = ? LIMIT 1')
    .get(ref, ref) as { id: string } | undefined;
  return row?.id ?? null;
}

function parsePositiveInt(v: any, def: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}
