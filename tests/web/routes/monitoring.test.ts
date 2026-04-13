import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import type Database from 'better-sqlite3';
import { createTestApp } from '../test-app.js';
import { generateUuid } from '../../../src/utils/uuid.js';
import { snapshotScore } from '../../../src/services/scoring/snapshot.js';

describe('Monitoring API routes', () => {
  let app: express.Express;
  let database: Database.Database;
  let catalogId: string;

  beforeEach(() => {
    ({ app, database } = createTestApp());
    catalogId = (database.prepare('SELECT id FROM catalogs LIMIT 1').get() as { id: string }).id;
  });

  describe('GET /api/monitoring/status', () => {
    it('returns an empty envelope when no snapshots exist', async () => {
      const res = await request(app).get('/api/monitoring/status');
      expect(res.status).toBe(200);
      expect(res.body.summary.total_checked).toBe(0);
      expect(res.body.findings).toEqual([]);
      expect(res.body.recent_alerts).toEqual([]);
    });

    it('returns findings after snapshots are taken', async () => {
      snapshotScore(database, catalogId);
      const res = await request(app).get('/api/monitoring/status');
      expect(res.status).toBe(200);
      expect(res.body.summary.total_checked).toBe(1);
      expect(res.body.findings.length).toBe(1);
      expect(res.body.findings[0].catalog_id).toBe(catalogId);
    });

    it('status is read-only and does not create alerts', async () => {
      snapshotScore(database, catalogId);
      await request(app).get('/api/monitoring/status');
      const count = (database.prepare(
        `SELECT COUNT(*) AS c FROM drift_alerts WHERE alert_type = 'posture_change'`,
      ).get() as { c: number }).c;
      expect(count).toBe(0);
    });
  });

  describe('POST /api/monitoring/run', () => {
    it('runs the monitor and creates alerts', async () => {
      snapshotScore(database, catalogId); // score = 0, below critical

      const res = await request(app).post('/api/monitoring/run');
      expect(res.status).toBe(200);
      expect(res.body.checked).toBe(1);
      expect(res.body.alerts_created).toBeGreaterThan(0);

      const count = (database.prepare(
        `SELECT COUNT(*) AS c FROM drift_alerts WHERE alert_type = 'posture_change'`,
      ).get() as { c: number }).c;
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('GET /api/monitoring/thresholds', () => {
    it('returns an empty list initially', async () => {
      const res = await request(app).get('/api/monitoring/thresholds');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns configured thresholds after upsert', async () => {
      await request(app)
        .put('/api/monitoring/thresholds')
        .send({ warning_threshold: 85, critical_threshold: 70 });

      const res = await request(app).get('/api/monitoring/thresholds');
      expect(res.body.length).toBe(1);
      expect(res.body[0].warning_threshold).toBe(85);
    });
  });

  describe('GET /api/monitoring/thresholds/resolve', () => {
    it('returns built-in defaults when no config exists', async () => {
      const catalogShort = (database.prepare('SELECT short_name FROM catalogs LIMIT 1').get() as { short_name: string }).short_name;
      const res = await request(app).get(`/api/monitoring/thresholds/resolve?catalog=${catalogShort}`);
      expect(res.status).toBe(200);
      expect(res.body.warning_threshold).toBe(80);
      expect(res.body.critical_threshold).toBe(60);
      expect(res.body.id).toBe('default');
    });

    it('returns 400 when catalog is missing', async () => {
      const res = await request(app).get('/api/monitoring/thresholds/resolve');
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown catalog', async () => {
      const res = await request(app).get('/api/monitoring/thresholds/resolve?catalog=not-a-thing');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/monitoring/thresholds', () => {
    it('upserts a new threshold row', async () => {
      const res = await request(app)
        .put('/api/monitoring/thresholds')
        .send({
          warning_threshold: 90,
          critical_threshold: 75,
          delta_warning: 3,
          delta_critical: 8,
          trend_window: 5,
        });
      expect(res.status).toBe(200);
      expect(res.body.warning_threshold).toBe(90);
      expect(res.body.trend_window).toBe(5);
      expect(res.body.id).not.toBe('default');
    });

    it('updates an existing threshold in place', async () => {
      await request(app).put('/api/monitoring/thresholds').send({ warning_threshold: 85 });
      const second = await request(app).put('/api/monitoring/thresholds').send({ warning_threshold: 92 });
      expect(second.body.warning_threshold).toBe(92);

      const list = await request(app).get('/api/monitoring/thresholds');
      expect(list.body.length).toBe(1);
    });

    it('rejects negative thresholds', async () => {
      const res = await request(app).put('/api/monitoring/thresholds').send({ warning_threshold: -1 });
      expect(res.status).toBe(400);
    });

    it('rejects non-integer trend_window', async () => {
      const res = await request(app).put('/api/monitoring/thresholds').send({ trend_window: 2.5 });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/monitoring/thresholds/:id', () => {
    it('removes a threshold row', async () => {
      const put = await request(app).put('/api/monitoring/thresholds').send({ warning_threshold: 88 });
      const id = put.body.id;

      const del = await request(app).delete(`/api/monitoring/thresholds/${id}`);
      expect(del.status).toBe(200);

      const list = await request(app).get('/api/monitoring/thresholds');
      expect(list.body).toEqual([]);
    });
  });
});
