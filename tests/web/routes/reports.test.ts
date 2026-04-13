import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import type Database from 'better-sqlite3';
import { createTestApp } from '../test-app.js';

describe('Reports API routes', () => {
  let app: express.Express;
  let database: Database.Database;
  let catalogShort: string;

  beforeEach(() => {
    ({ app, database } = createTestApp());
    catalogShort = (database.prepare('SELECT short_name FROM catalogs LIMIT 1').get() as { short_name: string }).short_name;
  });

  describe('GET /api/reports/audit/preview', () => {
    it('returns structured report data as JSON', async () => {
      const res = await request(app).get(`/api/reports/audit/preview?catalog=${catalogShort}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('organization');
      expect(res.body).toHaveProperty('catalog');
      expect(res.body).toHaveProperty('controls');
      expect(res.body).toHaveProperty('evidence_summary');
      expect(res.body).toHaveProperty('risks');
      expect(res.body).toHaveProperty('poam');
      expect(res.body).toHaveProperty('methodology');
      expect(res.body.catalog.short_name).toBe(catalogShort);
    });

    it('returns 400 when catalog is missing', async () => {
      const res = await request(app).get('/api/reports/audit/preview');
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown catalog', async () => {
      const res = await request(app).get('/api/reports/audit/preview?catalog=nope');
      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown scope', async () => {
      const res = await request(app).get(`/api/reports/audit/preview?catalog=${catalogShort}&scope=not-a-scope`);
      expect(res.status).toBe(404);
    });

    it('accepts trend_days query param', async () => {
      const res = await request(app).get(`/api/reports/audit/preview?catalog=${catalogShort}&trend_days=30`);
      expect(res.status).toBe(200);
      expect(res.body.catalog.short_name).toBe(catalogShort);
    });
  });

  describe('GET /api/reports/audit', () => {
    it('returns a PDF download by default', async () => {
      const res = await request(app).get(`/api/reports/audit?catalog=${catalogShort}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('.pdf');
      expect(res.body.length).toBeGreaterThan(500);
      // PDF magic header
      expect(res.body.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
    });

    it('returns a DOCX download when format=docx', async () => {
      const res = await request(app)
        .get(`/api/reports/audit?catalog=${catalogShort}&format=docx`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml');
      expect(res.headers['content-disposition']).toContain('.docx');
      const body = res.body as Buffer;
      // DOCX is a ZIP — starts with PK\x03\x04
      expect(body[0]).toBe(0x50);
      expect(body[1]).toBe(0x4b);
    });

    it('rejects an invalid format', async () => {
      const res = await request(app).get(`/api/reports/audit?catalog=${catalogShort}&format=xlsx`);
      expect(res.status).toBe(400);
    });

    it('returns 400 without catalog', async () => {
      const res = await request(app).get('/api/reports/audit');
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown catalog', async () => {
      const res = await request(app).get('/api/reports/audit?catalog=ghost&format=pdf');
      expect(res.status).toBe(404);
    });
  });
});
