import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createTestApp } from '../test-app.js';
import { snapshotScore } from '../../../src/services/scoring/snapshot.js';
import type Database from 'better-sqlite3';

describe('Scores API routes', () => {
  let app: express.Express;
  let database: Database.Database;
  let catalogShort: string;
  let catalogId: string;

  beforeEach(() => {
    ({ app, database } = createTestApp());
    const row = database.prepare('SELECT id, short_name FROM catalogs LIMIT 1').get() as
      | { id: string; short_name: string } | undefined;
    catalogShort = row!.short_name;
    catalogId = row!.id;
  });

  describe('GET /api/scores/:scopeRef/:catalogRef', () => {
    it('returns a computed score when no snapshot exists', async () => {
      const res = await request(app).get(`/api/scores/org/${catalogShort}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('overall_score');
      expect(res.body).toHaveProperty('coverage_score');
      expect(res.body.persisted).toBe(false);
    });

    it('returns the persisted snapshot when one exists', async () => {
      snapshotScore(database, catalogId);
      const res = await request(app).get(`/api/scores/org/${catalogShort}`);
      expect(res.status).toBe(200);
      expect(res.body.persisted).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    it('returns 404 for unknown catalog', async () => {
      const res = await request(app).get('/api/scores/org/not-a-real-catalog');
      expect(res.status).toBe(404);
    });

    it('returns 404 for unknown scope', async () => {
      const res = await request(app).get(`/api/scores/not-a-scope/${catalogShort}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/scores/:scopeRef/:catalogRef/history', () => {
    it('returns an empty history when no snapshots exist', async () => {
      const res = await request(app).get(`/api/scores/org/${catalogShort}/history`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toEqual([]);
      expect(res.body.since_days).toBe(90);
    });

    it('returns history entries after snapshots are taken', async () => {
      snapshotScore(database, catalogId);
      snapshotScore(database, catalogId);
      const res = await request(app).get(`/api/scores/org/${catalogShort}/history`);
      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBe(2);
    });

    it('respects the days query param', async () => {
      snapshotScore(database, catalogId);
      const res = await request(app).get(`/api/scores/org/${catalogShort}/history?days=7`);
      expect(res.body.since_days).toBe(7);
    });
  });

  describe('POST /api/scores/:scopeRef/:catalogRef/snapshot', () => {
    it('creates a snapshot row', async () => {
      const res = await request(app).post(`/api/scores/org/${catalogShort}/snapshot`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.overall_score).toBeDefined();

      const count = database
        .prepare('SELECT COUNT(*) AS c FROM compliance_scores WHERE catalog_id = ?')
        .get(catalogId) as { c: number };
      expect(count.c).toBe(1);
    });

    it('overwrites existing snapshot on repeat calls', async () => {
      await request(app).post(`/api/scores/org/${catalogShort}/snapshot`);
      await request(app).post(`/api/scores/org/${catalogShort}/snapshot`);
      await request(app).post(`/api/scores/org/${catalogShort}/snapshot`);

      const count = database
        .prepare('SELECT COUNT(*) AS c FROM compliance_scores WHERE catalog_id = ?')
        .get(catalogId) as { c: number };
      expect(count.c).toBe(1);

      const history = database
        .prepare('SELECT COUNT(*) AS c FROM compliance_score_history WHERE catalog_id = ?')
        .get(catalogId) as { c: number };
      expect(history.c).toBe(3);
    });
  });

  describe('GET /api/scores/:scopeRef/summary', () => {
    it('returns empty catalogs list when no snapshots exist', async () => {
      const res = await request(app).get('/api/scores/org/summary');
      expect(res.status).toBe(200);
      expect(res.body.catalogs).toEqual([]);
    });

    it('returns all catalog snapshots for a scope', async () => {
      snapshotScore(database, catalogId);
      const res = await request(app).get('/api/scores/org/summary');
      expect(res.status).toBe(200);
      expect(res.body.catalogs.length).toBe(1);
      expect(res.body.scope_id).toBeNull();
    });

    it('snapshots on demand when compute=true and none exist', async () => {
      const res = await request(app).get('/api/scores/org/summary?compute=true');
      expect(res.status).toBe(200);
      expect(res.body.catalogs.length).toBe(1);
    });
  });
});
