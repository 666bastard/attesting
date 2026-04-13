import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import type Database from 'better-sqlite3';
import { createTestApp } from '../test-app.js';

describe('Evidence API routes', () => {
  let app: express.Express;
  let database: Database.Database;
  let implId: string;

  beforeEach(() => {
    ({ app, database } = createTestApp());
    implId = (database.prepare('SELECT id FROM implementations LIMIT 1').get() as { id: string }).id;
  });

  describe('POST /api/evidence', () => {
    it('creates a draft evidence row', async () => {
      const res = await request(app)
        .post('/api/evidence')
        .send({ title: 'MFA Screenshot', implementation_id: implId, renewal_period_days: 90 });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.version).toBe(1);
    });

    it('rejects without a title', async () => {
      const res = await request(app).post('/api/evidence').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/evidence', () => {
    it('lists all evidence with freshness classification', async () => {
      await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId });
      await request(app).post('/api/evidence').send({ title: 'B', implementation_id: implId });
      const res = await request(app).get('/api/evidence');
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].freshness).toBe('pending');
    });

    it('filters by status', async () => {
      await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId });
      const res = await request(app).get('/api/evidence?status=draft');
      expect(res.body.length).toBe(1);
    });
  });

  describe('GET /api/evidence/:id', () => {
    it('returns detail with history', async () => {
      const created = (await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId })).body;
      const res = await request(app).get(`/api/evidence/${created.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.id);
      expect(res.body.history.length).toBeGreaterThanOrEqual(1);
      expect(res.body.freshness).toBe('pending');
    });

    it('returns 404 for missing id', async () => {
      const res = await request(app).get('/api/evidence/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/evidence/:id', () => {
    it('updates metadata', async () => {
      const created = (await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId })).body;
      const res = await request(app)
        .put(`/api/evidence/${created.id}`)
        .send({ description: 'updated' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('updated');
    });

    it('rejects empty updates', async () => {
      const created = (await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId })).body;
      const res = await request(app).put(`/api/evidence/${created.id}`).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/evidence/:id/transition', () => {
    async function createAndSubmit(): Promise<string> {
      const created = (await request(app)
        .post('/api/evidence')
        .send({ title: 'A', implementation_id: implId, renewal_period_days: 30 })).body;
      await request(app).post(`/api/evidence/${created.id}/transition`).send({ action: 'submit' });
      return created.id;
    }

    it('walks the happy path through accept', async () => {
      const id = await createAndSubmit();
      const reviewed = await request(app)
        .post(`/api/evidence/${id}/transition`)
        .send({ action: 'review', reviewer_id: 'rev-1' });
      if (reviewed.status !== 200) {
        throw new Error(`review status ${reviewed.status}: ${JSON.stringify(reviewed.body)}`);
      }
      expect(reviewed.body.status).toBe('reviewed');

      const accepted = await request(app)
        .post(`/api/evidence/${id}/transition`)
        .send({ action: 'accept', reviewer_id: 'rev-1', notes: 'lgtm' });
      expect(accepted.status).toBe(200);
      expect(accepted.body.status).toBe('accepted');
      expect(accepted.body.valid_until).toBeTruthy();
    });

    it('returns 409 for an invalid transition', async () => {
      const created = (await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId })).body;
      const res = await request(app)
        .post(`/api/evidence/${created.id}/transition`)
        .send({ action: 'accept', reviewer_id: 'r' });
      expect(res.status).toBe(409);
      expect(res.body.from_status).toBe('draft');
    });

    it('returns 400 when reviewer_id is missing for review', async () => {
      const id = await createAndSubmit();
      const res = await request(app).post(`/api/evidence/${id}/transition`).send({ action: 'review' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when action is missing', async () => {
      const id = await createAndSubmit();
      const res = await request(app).post(`/api/evidence/${id}/transition`).send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/evidence/freshness', () => {
    it('returns empty buckets when no evidence exists', async () => {
      const res = await request(app).get('/api/evidence/freshness');
      expect(res.status).toBe(200);
      expect(res.body.overall.fresh).toBe(0);
      expect(res.body.by_catalog.length).toBeGreaterThanOrEqual(1);
    });

    it('reports pending after a draft is created', async () => {
      await request(app).post('/api/evidence').send({ title: 'A', implementation_id: implId });
      const res = await request(app).get('/api/evidence/freshness');
      expect(res.body.overall.pending).toBe(1);
    });
  });

  describe('POST /api/evidence/sweep', () => {
    it('returns a sweep result shape', async () => {
      const res = await request(app).post('/api/evidence/sweep');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('checked');
      expect(res.body).toHaveProperty('transitioned_expired');
    });
  });

  describe('propagation integration', () => {
    it('evidence state change triggers score recalc', async () => {
      const created = (await request(app)
        .post('/api/evidence')
        .send({ title: 'A', implementation_id: implId, renewal_period_days: 30 })).body;
      await request(app).post(`/api/evidence/${created.id}/transition`).send({ action: 'submit' });
      await request(app).post(`/api/evidence/${created.id}/transition`).send({ action: 'review', reviewer_id: 'r' });
      await request(app).post(`/api/evidence/${created.id}/transition`).send({ action: 'accept', reviewer_id: 'r' });

      const scores = database.prepare('SELECT * FROM compliance_scores').all();
      expect(scores.length).toBeGreaterThan(0);
    });
  });
});
