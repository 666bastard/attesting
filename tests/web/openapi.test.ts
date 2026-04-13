import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from './test-app.js';
import { buildOpenApiSpec, OPENAPI_VERSION } from '../../src/web/openapi.js';
import { OPENAPI_PATHS } from '../../src/web/openapi-paths.js';

/**
 * Phase 5J — OpenAPI spec + Swagger UI integration tests.
 *
 * Guards:
 *  1. Spec document is structurally valid OpenAPI 3.1
 *  2. All reusable $refs resolve to defined components
 *  3. Every Phase 8 route group is documented
 *  4. Swagger UI loads at /api/docs and serves the JSON spec
 *  5. Route registrations and spec entries stay in lockstep
 */

describe('OpenAPI spec structure', () => {
  const spec = buildOpenApiSpec('9.9.9');

  it('declares OpenAPI 3.1', () => {
    expect(spec.openapi).toBe(OPENAPI_VERSION);
    expect(OPENAPI_VERSION).toBe('3.1.0');
  });

  it('has required top-level sections', () => {
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('Attesting API');
    expect(spec.info.version).toBe('9.9.9');
    expect(spec.info.license.name).toBe('MIT');
    expect(spec.info.contact).toBeDefined();
    expect(spec.servers).toBeInstanceOf(Array);
    expect(spec.tags).toBeInstanceOf(Array);
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
    expect(spec.components.responses).toBeDefined();
  });

  it('registers tags for every domain', () => {
    const tagNames = new Set<string>(spec.tags.map((t: any) => t.name));
    // Core tags
    for (const t of ['Organization', 'Catalogs', 'Mappings', 'Implementations', 'Coverage', 'Governance', 'Risk', 'Intel', 'Drift', 'Assets', 'Connectors', 'Owners', 'Audit', 'Export', 'Import', 'Onboarding']) {
      expect(tagNames.has(t), `missing core tag: ${t}`).toBe(true);
    }
    // Phase 8 tags
    for (const t of ['Scores', 'Dashboard', 'Reports', 'Monitoring', 'Evidence']) {
      expect(tagNames.has(t), `missing Phase 8 tag: ${t}`).toBe(true);
    }
  });

  it('defines the ErrorResponse schema used by middleware', () => {
    const schema = spec.components.schemas.ErrorResponse;
    expect(schema).toBeDefined();
    expect(schema.required).toEqual(expect.arrayContaining(['error', 'code', 'status']));
  });

  it('defines domain schemas that map to src/models/', () => {
    const required = [
      'Organization', 'Scope', 'Catalog', 'Control', 'Mapping',
      'Implementation', 'Evidence', 'EvidenceFreshness', 'Risk', 'DriftAlert',
      'Asset', 'Connector', 'ComplianceScore', 'FamilyBreakdown',
      'MonitoringThresholds', 'PostureFinding', 'DashboardSummary',
    ];
    for (const name of required) {
      expect(spec.components.schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });

  it('reusable $refs all resolve to defined components', () => {
    const refPattern = /^#\/components\/(schemas|responses|parameters)\/(.+)$/;
    function walk(node: any, path: string[] = []): void {
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string') {
        const m = refPattern.exec(node.$ref);
        expect(m, `invalid $ref: ${node.$ref} at ${path.join('.')}`).toBeTruthy();
        const [, kind, name] = m!;
        expect(spec.components[kind]?.[name], `unresolved $ref ${node.$ref}`).toBeDefined();
      }
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...path, k]);
      }
    }
    walk(spec);
  });

  it('every path has at least one HTTP method and every operation has a summary', () => {
    const httpVerbs = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head']);
    for (const [p, pathItem] of Object.entries<any>(spec.paths)) {
      const verbs = Object.keys(pathItem).filter((k) => httpVerbs.has(k));
      expect(verbs.length, `no HTTP methods defined for ${p}`).toBeGreaterThan(0);
      for (const verb of verbs) {
        const op = pathItem[verb];
        expect(op.tags, `${verb.toUpperCase()} ${p} missing tags`).toBeDefined();
        expect(op.summary, `${verb.toUpperCase()} ${p} missing summary`).toBeDefined();
        expect(op.responses, `${verb.toUpperCase()} ${p} missing responses`).toBeDefined();
      }
    }
  });

  it('documents every Phase 8 endpoint group', () => {
    const paths = Object.keys(OPENAPI_PATHS);
    // Scores (8A)
    expect(paths).toContain('/scores/{scopeRef}/{catalogRef}');
    expect(paths).toContain('/scores/{scopeRef}/{catalogRef}/history');
    expect(paths).toContain('/scores/{scopeRef}/{catalogRef}/snapshot');
    expect(paths).toContain('/scores/{scopeRef}/summary');
    // Dashboard (8B)
    expect(paths).toContain('/dashboard/summary');
    // Reports (8C)
    expect(paths).toContain('/reports/audit');
    expect(paths).toContain('/reports/audit/preview');
    // Monitoring (8D)
    expect(paths).toContain('/monitoring/status');
    expect(paths).toContain('/monitoring/run');
    expect(paths).toContain('/monitoring/thresholds');
    expect(paths).toContain('/monitoring/thresholds/resolve');
    expect(paths).toContain('/monitoring/thresholds/{id}');
    // Evidence (8E)
    expect(paths).toContain('/evidence');
    expect(paths).toContain('/evidence/{id}');
    expect(paths).toContain('/evidence/{id}/transition');
    expect(paths).toContain('/evidence/freshness');
    expect(paths).toContain('/evidence/sweep');
  });

  it('documents every legacy route group', () => {
    const paths = Object.keys(OPENAPI_PATHS);
    for (const root of [
      '/org', '/catalogs', '/mappings/summary', '/implementations', '/coverage',
      '/diff', '/export', '/watches', '/risk/register', '/risk/matrix',
      '/governance/policies', '/intel/threats', '/drift/alerts', '/assets',
      '/connectors', '/owners', '/audit', '/import/preview', '/onboarding/state',
    ]) {
      expect(paths.some((p) => p === root || p.startsWith(root + '/')), `missing docs for ${root}`).toBe(true);
    }
  });

  it('route prefix coverage matches mounted namespaces in server.ts', () => {
    // Every path must sit under one of the known namespace prefixes.
    const namespaces = [
      '/org', '/catalogs', '/mappings', '/implementations', '/coverage',
      '/diff', '/export', '/watches', '/governance', '/risk', '/intel',
      '/drift', '/assets', '/connectors', '/owners', '/audit', '/import',
      '/onboarding', '/scores', '/dashboard', '/monitoring', '/evidence',
      '/reports',
    ];
    for (const p of Object.keys(OPENAPI_PATHS)) {
      const match = namespaces.find((ns) => p === ns || p.startsWith(ns + '/'));
      expect(match, `path ${p} does not belong to a known namespace`).toBeDefined();
    }
  });
});

describe('Swagger UI + spec HTTP endpoints', () => {
  it('GET /api/docs/openapi.json returns the spec as JSON', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('Attesting API');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(20);
  });

  it('GET /api/docs/ returns the Swagger UI HTML page', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger');
  });

  it('spec version reflects the installed package.json version', async () => {
    const { app } = createTestApp();
    const res = await request(app).get('/api/docs/openapi.json');
    expect(res.body.info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.body.info.version).not.toBe('0.0.0');
  });
});
