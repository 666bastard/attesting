import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedOrg,
  seedCatalog,
  seedImplementation,
} from '../helpers/test-db.js';
import { aggregateReportData } from '../../src/services/reports/aggregate.js';
import { renderAuditReportPdf } from '../../src/exporters/pdf-audit-report.js';
import { renderAuditReportDocx } from '../../src/exporters/docx-audit-report.js';
import { snapshotScore } from '../../src/services/scoring/snapshot.js';

describe('audit report exporters', () => {
  let db: Database.Database;
  let tmpDir: string;
  let catId: string;
  let orgId: string;
  let controlIds: string[];

  beforeEach(() => {
    db = createTestDb();
    ({ orgId } = seedOrg(db));
    ({ catId, controlIds } = seedCatalog(db, 3));
    seedImplementation(db, orgId, controlIds[0], 'implemented');
    seedImplementation(db, orgId, controlIds[1], 'partially-implemented');
    snapshotScore(db, catId);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attesting-report-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('PDF', () => {
    it('produces a non-empty PDF file', async () => {
      const data = aggregateReportData(db, { catalog_id: catId });
      const outputPath = path.join(tmpDir, 'audit.pdf');

      const result = await renderAuditReportPdf(data, outputPath);

      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.bytes).toBeGreaterThan(1000);
      expect(result.pages).toBeGreaterThanOrEqual(1);

      // Verify PDF magic header
      const header = fs.readFileSync(result.path).subarray(0, 5).toString('utf-8');
      expect(header).toBe('%PDF-');
    });

    it('still generates with an empty control catalog', async () => {
      const freshDb = createTestDb();
      const { orgId: o2 } = seedOrg(freshDb);
      const { catId: c2 } = seedCatalog(freshDb, 0);

      const data = aggregateReportData(freshDb, { catalog_id: c2 });
      const outputPath = path.join(tmpDir, 'empty.pdf');
      const result = await renderAuditReportPdf(data, outputPath);

      expect(result.bytes).toBeGreaterThan(500);
      void o2;
    });
  });

  describe('DOCX', () => {
    it('produces a non-empty DOCX file with correct magic', async () => {
      const data = aggregateReportData(db, { catalog_id: catId });
      const outputPath = path.join(tmpDir, 'audit.docx');

      const result = await renderAuditReportDocx(data, outputPath);

      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.bytes).toBeGreaterThan(1000);

      // DOCX is a ZIP — starts with PK\x03\x04
      const bytes = fs.readFileSync(result.path);
      expect(bytes[0]).toBe(0x50); // P
      expect(bytes[1]).toBe(0x4b); // K
      expect(bytes[2]).toBe(0x03);
      expect(bytes[3]).toBe(0x04);
    });

    it('handles empty family breakdown without crashing', async () => {
      const freshDb = createTestDb();
      seedOrg(freshDb);
      const { catId: c2 } = seedCatalog(freshDb, 0);
      const data = aggregateReportData(freshDb, { catalog_id: c2 });

      const outputPath = path.join(tmpDir, 'empty.docx');
      const result = await renderAuditReportDocx(data, outputPath);
      expect(result.bytes).toBeGreaterThan(500);
    });
  });
});
