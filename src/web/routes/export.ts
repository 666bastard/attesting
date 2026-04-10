import { Router } from 'express';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { db } from '../../db/connection.js';
import { exportCsvFlat } from '../../exporters/csv-flat.js';
import { exportOscalComponentDefinition } from '../../exporters/oscal-json.js';
import { exportSigQuestionnaire } from '../../exporters/sig-questionnaire.js';
import { exportSoaWorkbook } from '../../exporters/soa-workbook.js';

export function exportRoutes(): Router {
  const router = Router();

  // POST /api/export — generate an export file and return download path
  router.post('/', async (req, res) => {
    const database = db.getDb();
    const { format, catalog, scope } = req.body;

    if (!format) {
      res.status(400).json({ error: '"format" is required' });
      return;
    }

    const validFormats = ['csv', 'oscal', 'sig', 'soa', 'pdf'];
    if (!validFormats.includes(format)) {
      res.status(400).json({ error: `Unsupported format "${format}". Supported: ${validFormats.join(', ')}` });
      return;
    }

    // Sanitize filename — no path traversal
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeScope = (scope || 'all').replace(/[^a-zA-Z0-9_-]/g, '_');
    const exportDir = path.join(os.homedir(), '.attesting', 'exports');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    try {
      let outputPath: string;
      let result: Record<string, unknown>;

      switch (format) {
        case 'csv': {
          outputPath = path.join(exportDir, `attesting-${safeScope}-${timestamp}.csv`);
          result = exportCsvFlat(scope || undefined, true, outputPath, database);
          break;
        }
        case 'oscal': {
          outputPath = path.join(exportDir, `attesting-${safeScope}-${timestamp}.json`);
          result = exportOscalComponentDefinition(
            scope || 'Default',
            catalog ? [catalog] : [],
            outputPath,
            database
          );
          break;
        }
        case 'sig': {
          outputPath = path.join(exportDir, `attesting-sig-${safeScope}-${timestamp}.xlsx`);
          result = await exportSigQuestionnaire({
            catalogShortName: catalog || 'sig-lite-2026',
            scopeName: scope || undefined,
            mode: 'response-sig',
            outputPath,
          }, database);
          break;
        }
        case 'soa': {
          outputPath = path.join(exportDir, `attesting-soa-${safeScope}-${timestamp}.xlsx`);
          result = await exportSoaWorkbook(scope || undefined, outputPath, database);
          break;
        }
        default:
          res.status(400).json({ error: `Format "${format}" not yet implemented via API` });
          return;
      }

      res.json({
        format,
        outputPath,
        filename: path.basename(outputPath),
        ...result,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'Export failed', details: msg });
    }
  });

  // GET /api/export/download/:filename — download an exported file
  router.get('/download/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // sanitize
    const exportDir = path.join(os.homedir(), '.attesting', 'exports');
    const filePath = path.join(exportDir, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.download(filePath);
  });

  return router;
}
