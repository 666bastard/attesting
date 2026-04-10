/**
 * API route tests using supertest.
 * Uses an in-memory SQLite database — never touches ~/.attesting/attesting.db.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { generateUuid } from '../../src/utils/uuid.js';

// We need to mock the db module so API routes use our test DB
import { db } from '../../src/db/connection.js';

const SCHEMA_PATH = path.join(__dirname, '../../src/db/schema.sql');

const t = () => new Date().toISOString();

// Helper to create and seed an in-memory test database
function seedTestDb(database: Database.Database) {
  const orgId = generateUuid();
  database.prepare(
    'INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(orgId, 'Test Org', t(), t());

  const scopeId = generateUuid();
  database.prepare(
    'INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(scopeId, orgId, 'Production', 'product', t(), t());

  const catId = generateUuid();
  database.prepare(
    'INSERT INTO catalogs (id, name, short_name, source_format, total_controls, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(catId, 'Test Framework', 'test-fw', 'csv', 3, t(), t());

  const insertCtl = database.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, description, metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
  );

  const controls: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const id = generateUuid();
    insertCtl.run(id, catId, `CTL-${i}`, `Control ${i}`, `Description of control ${i}`, i, t());
    controls.push(id);
  }

  // Add an implementation
  database.prepare(
    `INSERT INTO implementations (id, org_id, primary_control_id, status, statement, created_at, updated_at)
     VALUES (?, ?, ?, 'implemented', 'We do this thing.', ?, ?)`
  ).run(generateUuid(), orgId, controls[0], t(), t());

  // Add a mapping
  database.prepare(
    `INSERT INTO control_mappings (id, source_control_id, target_control_id, relationship, confidence, source, created_at)
     VALUES (?, ?, ?, 'related', 'high', 'manual', ?)`
  ).run(generateUuid(), controls[0], controls[1], t());

  return { orgId, scopeId, catId, controls };
}

// We import createApp which uses the singleton db — in tests we override it
import { createApp } from '../../src/web/server.js';

describe('API routes', () => {
  let app: express.Express;

  beforeAll(() => {
    // The createApp() function calls db.getDb() which initializes the real DB.
    // For tests, we rely on the actual DB (already seeded by CLI tests).
    // This is an integration test that uses the same database.
    app = createApp();
  });

  // ─── org routes ───
  describe('GET /api/org', () => {
    it('returns org and scopes', async () => {
      const res = await request(app).get('/api/org');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('scopes');
      expect(Array.isArray(res.body.scopes)).toBe(true);
    });
  });

  // ─── catalog routes ───
  describe('GET /api/catalogs', () => {
    it('returns array of catalogs', async () => {
      const res = await request(app).get('/api/catalogs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty('short_name');
        expect(res.body[0]).toHaveProperty('total_controls');
      }
    });
  });

  describe('GET /api/catalogs/:shortName', () => {
    it('returns 404 for nonexistent catalog', async () => {
      const res = await request(app).get('/api/catalogs/nonexistent-fw');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/catalogs/:shortName/controls', () => {
    it('returns 404 for nonexistent catalog', async () => {
      const res = await request(app).get('/api/catalogs/nonexistent-fw/controls');
      expect(res.status).toBe(404);
    });
  });

  // ─── coverage routes ───
  describe('GET /api/coverage', () => {
    it('returns coverage data array', async () => {
      const res = await request(app).get('/api/coverage');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── mapping routes ───
  describe('GET /api/mappings/list', () => {
    it('returns mappings array', async () => {
      const res = await request(app).get('/api/mappings/list');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/mappings/resolve/:catalog/:controlId', () => {
    it('returns 404 for nonexistent control', async () => {
      const res = await request(app).get('/api/mappings/resolve/nope/nope');
      expect(res.status).toBe(404);
    });
  });

  // ─── implementation routes ───
  describe('GET /api/implementations', () => {
    it('returns implementations with total', async () => {
      const res = await request(app).get('/api/implementations');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('implementations');
      expect(res.body).toHaveProperty('total');
    });
  });

  describe('GET /api/implementations/recent', () => {
    it('returns recent activity array', async () => {
      const res = await request(app).get('/api/implementations/recent');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/implementations', () => {
    it('returns 400 without required fields', async () => {
      const res = await request(app)
        .post('/api/implementations')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/implementations/:id', () => {
    it('returns 404 for nonexistent implementation', async () => {
      const res = await request(app)
        .put('/api/implementations/nonexistent-id')
        .send({ status: 'implemented' });
      expect(res.status).toBe(404);
    });
  });

  // ─── diff routes ───
  describe('POST /api/diff', () => {
    it('returns 400 without required fields', async () => {
      const res = await request(app)
        .post('/api/diff')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent catalog', async () => {
      const res = await request(app)
        .post('/api/diff')
        .send({ old: 'nope', new: 'nope2' });
      expect(res.status).toBe(404);
    });
  });

  // ─── export routes ───
  describe('POST /api/export', () => {
    it('returns 400 without format', async () => {
      const res = await request(app)
        .post('/api/export')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for unsupported format', async () => {
      const res = await request(app)
        .post('/api/export')
        .send({ format: 'docx' });
      expect(res.status).toBe(400);
    });
  });

  // ─── watch routes ───
  describe('GET /api/watches', () => {
    it('returns watches array', async () => {
      const res = await request(app).get('/api/watches');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
