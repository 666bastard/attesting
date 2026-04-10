import { Router } from 'express';
import { db } from '../../db/connection.js';
import { previewImport, executeImport } from '../../services/import/pipeline.js';
import { scanFile, MAX_FILE_SIZE_BYTES } from '../../services/import/file-scanner.js';
import type { ImportFormat } from '../../services/import/detect-format.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

const uploadDir = path.join(os.homedir(), '.attesting', 'uploads');

function ensureUploadDir(): void {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

const ALLOWED_EXTENSIONS = ['.xlsx', '.json', '.csv'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => { ensureUploadDir(); cb(null, uploadDir); },
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[\/\\]/g, '_').replace(/[^\w.\-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 2,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Blocked file type: ${ext}. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }
  },
});

export function importRoutes(): Router {
  const router = Router();

  /**
   * POST /api/import/preview
   * Upload a file → scan → parse → return preview.
   */
  router.post('/preview', upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Scan file before processing
    const scan = scanFile(req.file.path, req.file.originalname, req.file.mimetype);
    if (!scan.safe) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(400).json({ error: 'File rejected by security scan', reason: scan.rejected_reason });
      return;
    }

    try {
      const formatOverride = typeof req.query.format === 'string'
        ? req.query.format as ImportFormat : undefined;

      const validFormats: ImportFormat[] = ['sig-xlsx', 'iso27001-xlsx', 'oscal-json', 'csv-generic'];
      if (formatOverride && !validFormats.includes(formatOverride)) {
        try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        res.status(400).json({ error: `Invalid format: "${formatOverride}". Accepted: ${validFormats.join(', ')}` });
        return;
      }

      const database = db.getDb();
      const preview = previewImport(database, req.file.path, req.file.originalname, formatOverride);

      res.json({
        ...preview,
        scan: { checks_passed: scan.checks_passed, file_size: scan.file_size },
        _upload_path: req.file.path,
        _original_name: req.file.originalname,
      });
    } catch (e: any) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/import/confirm
   * Execute a previously previewed import.
   */
  router.post('/confirm', (req, res) => {
    const { upload_path, original_name, format, overwrite } = req.body;

    if (!upload_path || !original_name) {
      res.status(400).json({ error: 'upload_path and original_name are required' });
      return;
    }

    // Path traversal guard
    const resolved = path.resolve(upload_path);
    if (!resolved.startsWith(path.resolve(uploadDir))) {
      res.status(400).json({ error: 'Invalid upload path' });
      return;
    }

    if (!fs.existsSync(resolved)) {
      res.status(400).json({ error: 'Upload file not found. Please re-upload.' });
      return;
    }

    // Re-scan before confirm
    const scan = scanFile(resolved, original_name);
    if (!scan.safe) {
      try { fs.unlinkSync(resolved); } catch { /* ignore */ }
      res.status(400).json({ error: 'File rejected on re-scan', reason: scan.rejected_reason });
      return;
    }

    const validFormats: ImportFormat[] = ['sig-xlsx', 'iso27001-xlsx', 'oscal-json', 'csv-generic'];
    if (format && !validFormats.includes(format)) {
      res.status(400).json({ error: `Invalid format: "${format}"` });
      return;
    }

    try {
      const database = db.getDb();
      const result = executeImport(database, resolved, original_name, format as ImportFormat | undefined, overwrite === true);
      try { fs.unlinkSync(resolved); } catch { /* ignore */ }
      res.status(201).json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/import/formats
   */
  router.get('/formats', (_req, res) => {
    res.json({
      max_file_size_mb: MAX_FILE_SIZE_BYTES / (1024 * 1024),
      allowed_extensions: ALLOWED_EXTENSIONS,
      formats: [
        { id: 'sig-xlsx', name: 'SIG Questionnaire', ext: '.xlsx', proprietary: true },
        { id: 'iso27001-xlsx', name: 'ISO 27001 Annex A', ext: '.xlsx', proprietary: true },
        { id: 'oscal-json', name: 'OSCAL Catalog (JSON)', ext: '.json', proprietary: false },
        { id: 'csv-generic', name: 'Generic CSV', ext: '.csv', proprietary: false },
      ],
    });
  });

  return router;
}
