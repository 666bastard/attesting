/**
 * Phase 5J — OpenAPI path definitions split into a dedicated file so the
 * main spec stays under the 300-line target. Every route registered in
 * src/web/routes/*.ts is documented here; tests assert completeness.
 */

const ERROR_400 = { $ref: '#/components/responses/BadRequest' };
const ERROR_404 = { $ref: '#/components/responses/NotFound' };
const ERROR_409 = { $ref: '#/components/responses/Conflict' };
const ERROR_500 = { $ref: '#/components/responses/ServerError' };

/** Shortcut for a simple 200 JSON response referencing a component schema. */
function ok200(schemaRef: string, description = 'OK'): any {
  return {
    description,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaRef}` } } },
  };
}

/** 200 response returning an array of the referenced component. */
function okArray(schemaRef: string, description = 'OK'): any {
  return {
    description,
    content: {
      'application/json': {
        schema: { type: 'array', items: { $ref: `#/components/schemas/${schemaRef}` } },
      },
    },
  };
}

/** 200 response with a free-form object (no component schema). */
function okObject(description = 'OK'): any {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object' } } },
  };
}

export const OPENAPI_PATHS: Record<string, any> = {
  // ── Organization ─────────────────────────────────────────
  '/org': {
    get: {
      tags: ['Organization'],
      summary: 'Get organization and scopes',
      responses: { 200: okObject('Organization profile with scope array') },
    },
  },

  // ── Catalogs ─────────────────────────────────────────────
  '/catalogs': {
    get: { tags: ['Catalogs'], summary: 'List all catalogs', responses: { 200: okArray('Catalog') } },
  },
  '/catalogs/{shortName}': {
    get: {
      tags: ['Catalogs'], summary: 'Get catalog detail',
      parameters: [{ name: 'shortName', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: ok200('Catalog'), 404: ERROR_404 },
    },
  },
  '/catalogs/{shortName}/controls': {
    get: {
      tags: ['Catalogs'], summary: 'List controls (paginated, FTS-searchable)',
      parameters: [
        { name: 'shortName', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: okObject('Controls page with total/limit/offset'), 404: ERROR_404 },
    },
  },
  '/catalogs/{shortName}/controls/{controlId}/params': {
    get: {
      tags: ['Catalogs'], summary: 'Get control parameters',
      parameters: [
        { name: 'shortName', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'controlId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: okObject() },
    },
  },
  '/catalogs/{shortName}/controls/{controlId}/params/{paramId}': {
    put: {
      tags: ['Catalogs'], summary: 'Set control parameter value',
      parameters: [
        { name: 'shortName', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'controlId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'paramId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { value: { type: 'string' }, set_by: { type: 'string' } } } } } },
      responses: { 200: okObject() },
    },
  },

  // ── Mappings ─────────────────────────────────────────────
  '/mappings/summary': { get: { tags: ['Mappings'], summary: 'Mapping stats + per-source counts', responses: { 200: okObject() } } },
  '/mappings/list': {
    get: {
      tags: ['Mappings'], summary: 'List mappings with filters',
      parameters: [
        { name: 'source', in: 'query', schema: { type: 'string' } },
        { name: 'target', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 1000 } },
      ],
      responses: { 200: okArray('Mapping') },
    },
  },
  '/mappings/resolve/{catalog}/{controlId}': {
    get: {
      tags: ['Mappings'], summary: 'Resolve direct + transitive mappings',
      parameters: [
        { name: 'catalog', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'controlId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'depth', in: 'query', schema: { type: 'integer', default: 2 } },
      ],
      responses: { 200: okObject(), 404: ERROR_404 },
    },
  },

  // ── Implementations ─────────────────────────────────────
  '/implementations': {
    get: {
      tags: ['Implementations'], summary: 'List implementations with filters',
      parameters: [
        { name: 'scope', in: 'query', schema: { type: 'string' } },
        { name: 'catalog', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
      ],
      responses: { 200: okObject() },
    },
    post: {
      tags: ['Implementations'], summary: 'Create implementation',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Implementation' } } } },
      responses: { 201: okObject(), 400: ERROR_400, 404: ERROR_404 },
    },
  },
  '/implementations/{id}': {
    put: {
      tags: ['Implementations'], summary: 'Update implementation',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Implementation' } } } },
      responses: { 200: okObject(), 404: ERROR_404 },
    },
  },
  '/implementations/recent': {
    get: { tags: ['Implementations'], summary: 'Last 10 changed implementations', responses: { 200: okArray('Implementation') } },
  },

  // ── Coverage ─────────────────────────────────────────────
  '/coverage': { get: { tags: ['Coverage'], summary: 'Coverage for all catalogs', responses: { 200: okObject() } } },
  '/coverage/{scopeName}': {
    get: {
      tags: ['Coverage'], summary: 'Coverage for a specific scope',
      parameters: [{ name: 'scopeName', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: okObject(), 404: ERROR_404 },
    },
  },

  // ── Diff ────────────────────────────────────────────────
  '/diff': {
    post: {
      tags: ['Diff'], summary: 'Run diff between two catalogs',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['old', 'new'], properties: { old: { type: 'string' }, new: { type: 'string' } } } } } },
      responses: { 200: okObject(), 400: ERROR_400, 404: ERROR_404 },
    },
  },

  // ── Export ──────────────────────────────────────────────
  '/export': {
    post: {
      tags: ['Export'], summary: 'Generate export file',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['format'], properties: { format: { type: 'string', enum: ['csv', 'oscal', 'sig', 'soa', 'pdf'] }, catalog: { type: 'string' }, scope: { type: 'string' } } } } } },
      responses: { 200: okObject(), 400: ERROR_400, 500: ERROR_500 },
    },
  },
  '/export/download/{filename}': {
    get: {
      tags: ['Export'], summary: 'Download exported file',
      parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'File binary' }, 404: ERROR_404 },
    },
  },

  // ── Watches ─────────────────────────────────────────────
  '/watches': { get: { tags: ['Watches'], summary: 'List watched catalog sources', responses: { 200: okObject() } } },

  // ── Governance ──────────────────────────────────────────
  '/governance/policies': {
    get: { tags: ['Governance'], summary: 'List policies', responses: { 200: okObject() } },
    post: { tags: ['Governance'], summary: 'Create policy', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject() } },
  },
  '/governance/policies/{id}': {
    get: { tags: ['Governance'], summary: 'Get policy + controls', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject(), 404: ERROR_404 } },
    put: { tags: ['Governance'], summary: 'Update policy', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 404: ERROR_404 } },
    delete: { tags: ['Governance'], summary: 'Delete policy', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },
  '/governance/policies/{id}/controls': {
    post: { tags: ['Governance'], summary: 'Link controls to policy', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 400: ERROR_400 } },
  },
  '/governance/committees': {
    get: { tags: ['Governance'], summary: 'List committees', responses: { 200: okObject() } },
    post: { tags: ['Governance'], summary: 'Create committee', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject() } },
  },
  '/governance/committees/{id}/meetings': {
    get: { tags: ['Governance'], summary: 'List meetings for committee', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
    post: { tags: ['Governance'], summary: 'Create meeting', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject() } },
  },
  '/governance/roles': {
    get: { tags: ['Governance'], summary: 'List roles register', responses: { 200: okObject() } },
    post: { tags: ['Governance'], summary: 'Create role', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject() } },
  },
  '/governance/roles/{id}': {
    put: { tags: ['Governance'], summary: 'Update role', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },

  // ── Risk ────────────────────────────────────────────────
  '/risk/register': {
    get: {
      tags: ['Risk'], summary: 'List risks',
      parameters: [
        { name: 'category', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'owner', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: okArray('Risk') },
    },
    post: { tags: ['Risk'], summary: 'Create risk', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Risk' } } } }, responses: { 201: okObject(), 400: ERROR_400 } },
  },
  '/risk/register/{id}': {
    get: { tags: ['Risk'], summary: 'Get risk detail', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok200('Risk'), 404: ERROR_404 } },
    put: { tags: ['Risk'], summary: 'Update risk', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Risk' } } } }, responses: { 200: okObject() } },
    delete: { tags: ['Risk'], summary: 'Delete risk', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },
  '/risk/register/{id}/controls': {
    post: { tags: ['Risk'], summary: 'Link controls to risk', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 400: ERROR_400 } },
  },
  '/risk/matrix': {
    get: { tags: ['Risk'], summary: 'Get risk matrix + distribution', responses: { 200: okObject() } },
    put: { tags: ['Risk'], summary: 'Update risk matrix', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },
  '/risk/exceptions': {
    get: { tags: ['Risk'], summary: 'List risk exceptions', responses: { 200: okObject() } },
    post: { tags: ['Risk'], summary: 'Create risk exception', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject() } },
  },
  '/risk/exceptions/{id}': {
    put: { tags: ['Risk'], summary: 'Update risk exception', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },
  '/risk/dashboard': { get: { tags: ['Risk'], summary: 'Risk dashboard metrics', responses: { 200: okObject() } } },

  // ── Intel ───────────────────────────────────────────────
  '/intel/threats': {
    get: {
      tags: ['Intel'], summary: 'List threat inputs',
      parameters: [
        { name: 'severity', in: 'query', schema: { type: 'string' } },
        { name: 'processed', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: { 200: okObject() },
    },
  },
  '/intel/threats/{id}': {
    get: { tags: ['Intel'], summary: 'Threat detail + correlations', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject(), 404: ERROR_404 } },
  },
  '/intel/manual': {
    get: { tags: ['Intel'], summary: 'List manual intel submissions', responses: { 200: okObject() } },
    post: { tags: ['Intel'], summary: 'Submit manual intel', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject(), 400: ERROR_400 } },
  },
  '/intel/manual/{id}': {
    get: { tags: ['Intel'], summary: 'Manual intel detail', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject(), 404: ERROR_404 } },
  },
  '/intel/manual/{id}/shadow': {
    get: { tags: ['Intel'], summary: 'Shadow impact analysis', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject(), 404: ERROR_404 } },
  },
  '/intel/manual/{id}/promote': {
    post: { tags: ['Intel'], summary: 'Promote manual intel to risk', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },
  '/intel/manual/{id}/archive': {
    post: { tags: ['Intel'], summary: 'Archive manual intel', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },

  // ── Drift ───────────────────────────────────────────────
  '/drift/alerts': {
    get: {
      tags: ['Drift'], summary: 'List drift alerts',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'resolved', 'suppressed'] } },
        { name: 'severity', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: okArray('DriftAlert') },
    },
  },
  '/drift/alerts/{id}': {
    get: { tags: ['Drift'], summary: 'Get drift alert + dispositions', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok200('DriftAlert'), 404: ERROR_404 } },
  },
  '/drift/alerts/{id}/resolve': {
    post: { tags: ['Drift'], summary: 'Resolve a drift alert', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },
  '/drift/dashboard': { get: { tags: ['Drift'], summary: 'Drift dashboard stats', responses: { 200: okObject() } } },
  '/drift/dispositions': {
    post: { tags: ['Drift'], summary: 'Create disposition', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 400: ERROR_400 } },
  },
  '/drift/dispositions/commit': {
    post: { tags: ['Drift'], summary: 'Commit a disposition', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject(), 400: ERROR_400 } },
  },
  '/drift/dispositions/{id}/approve': {
    post: { tags: ['Drift'], summary: 'Approve a disposition', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 400: ERROR_400 } },
  },
  '/drift/dispositions/{id}/reject': {
    post: { tags: ['Drift'], summary: 'Reject a disposition', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 400: ERROR_400 } },
  },
  '/drift/dispositions/pending': {
    get: { tags: ['Drift'], summary: 'List pending disposition approvals', responses: { 200: okObject() } },
  },

  // ── Assets ──────────────────────────────────────────────
  '/assets': {
    get: {
      tags: ['Assets'], summary: 'List assets',
      parameters: [
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'classification', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: okArray('Asset') },
    },
    post: { tags: ['Assets'], summary: 'Create asset', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } }, responses: { 201: okObject() } },
  },
  '/assets/{id}': {
    get: { tags: ['Assets'], summary: 'Asset detail + threats + risks', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok200('Asset'), 404: ERROR_404 } },
    put: { tags: ['Assets'], summary: 'Update asset', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } } }, responses: { 200: okObject(), 404: ERROR_404 } },
    delete: { tags: ['Assets'], summary: 'Delete asset', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },
  '/assets/dashboard/summary': {
    get: { tags: ['Assets'], summary: 'Asset dashboard stats', responses: { 200: okObject() } },
  },

  // ── Connectors ──────────────────────────────────────────
  '/connectors': {
    get: { tags: ['Connectors'], summary: 'List connectors with health stats', responses: { 200: okArray('Connector') } },
    post: { tags: ['Connectors'], summary: 'Create connector', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Connector' } } } }, responses: { 201: okObject() } },
  },
  '/connectors/adapters': { get: { tags: ['Connectors'], summary: 'List available adapter classes', responses: { 200: okObject() } } },
  '/connectors/{id}/sync': {
    post: { tags: ['Connectors'], summary: 'Run a sync (full or incremental)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { full: { type: 'boolean' } } } } } }, responses: { 200: okObject(), 404: ERROR_404, 500: ERROR_500 } },
  },
  '/connectors/{id}/healthcheck': {
    post: { tags: ['Connectors'], summary: 'Health check connector', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject(), 404: ERROR_404 } },
  },
  '/connectors/{id}/toggle': {
    put: { tags: ['Connectors'], summary: 'Enable/disable connector', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },
  '/connectors/{id}/logs': {
    get: {
      tags: ['Connectors'], summary: 'Connector sync logs',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
      ],
      responses: { 200: okObject() },
    },
  },

  // ── Owners ──────────────────────────────────────────────
  '/owners': {
    get: { tags: ['Owners'], summary: 'List owners', responses: { 200: okObject() } },
    post: { tags: ['Owners'], summary: 'Create owner', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject() } },
  },
  '/owners/{id}': {
    put: { tags: ['Owners'], summary: 'Update owner', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject(), 404: ERROR_404 } },
    delete: { tags: ['Owners'], summary: 'Delete owner', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },

  // ── Audit ───────────────────────────────────────────────
  '/audit': {
    get: {
      tags: ['Audit'], summary: 'Query audit log',
      parameters: [
        { name: 'entity_type', in: 'query', schema: { type: 'string' } },
        { name: 'entity_id', in: 'query', schema: { type: 'string' } },
        { name: 'action', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } },
      ],
      responses: { 200: okObject() },
    },
  },
  '/audit/entity/{type}/{id}': {
    get: {
      tags: ['Audit'], summary: 'Audit history for a specific entity',
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: okObject() },
    },
  },

  // ── Import ──────────────────────────────────────────────
  '/import/preview': {
    post: {
      tags: ['Import'], summary: 'Upload + preview an import',
      requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
      responses: { 200: okObject(), 400: ERROR_400, 500: ERROR_500 },
    },
  },
  '/import/confirm': {
    post: { tags: ['Import'], summary: 'Execute previewed import', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 201: okObject(), 400: ERROR_400 } },
  },
  '/import/formats': { get: { tags: ['Import'], summary: 'List supported import formats', responses: { 200: okObject() } } },

  // ── Onboarding ──────────────────────────────────────────
  '/onboarding/state': { get: { tags: ['Onboarding'], summary: 'Current onboarding state', responses: { 200: okObject() } } },
  '/onboarding/complete': { get: { tags: ['Onboarding'], summary: 'Check onboarding completion', responses: { 200: okObject() } } },
  '/onboarding/recommendations': { get: { tags: ['Onboarding'], summary: 'Framework recommendations', responses: { 200: okObject() } } },
  '/onboarding/complete/{stage}': {
    post: { tags: ['Onboarding'], summary: 'Complete an onboarding stage', parameters: [{ name: 'stage', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },
  '/onboarding/skip/{stage}': {
    post: { tags: ['Onboarding'], summary: 'Skip an onboarding stage', parameters: [{ name: 'stage', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },
  '/onboarding/seed-risks': {
    post: { tags: ['Onboarding'], summary: 'Seed risks from gap analysis', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 200: okObject() } },
  },
  '/onboarding/reset': {
    post: { tags: ['Onboarding'], summary: 'Reset onboarding progress', responses: { 200: okObject() } },
  },

  // ── Scores (Phase 8A) ───────────────────────────────────
  '/scores/{scopeRef}/summary': {
    get: {
      tags: ['Scores'], summary: 'Cross-catalog summary for a scope',
      parameters: [
        { $ref: '#/components/parameters/ScopeRef' },
        { name: 'compute', in: 'query', schema: { type: 'boolean' } },
      ],
      responses: { 200: okObject(), 404: ERROR_404 },
    },
  },
  '/scores/{scopeRef}/{catalogRef}': {
    get: {
      tags: ['Scores'], summary: 'Get current compliance score',
      parameters: [
        { $ref: '#/components/parameters/ScopeRef' },
        { $ref: '#/components/parameters/CatalogRef' },
      ],
      responses: { 200: ok200('ComplianceScore'), 404: ERROR_404 },
    },
  },
  '/scores/{scopeRef}/{catalogRef}/history': {
    get: {
      tags: ['Scores'], summary: 'Score trend history',
      parameters: [
        { $ref: '#/components/parameters/ScopeRef' },
        { $ref: '#/components/parameters/CatalogRef' },
        { name: 'days', in: 'query', schema: { type: 'integer', default: 90 } },
      ],
      responses: { 200: okObject(), 404: ERROR_404 },
    },
  },
  '/scores/{scopeRef}/{catalogRef}/snapshot': {
    post: {
      tags: ['Scores'], summary: 'Force a snapshot recomputation',
      parameters: [
        { $ref: '#/components/parameters/ScopeRef' },
        { $ref: '#/components/parameters/CatalogRef' },
      ],
      responses: { 200: ok200('ComplianceScore'), 404: ERROR_404 },
    },
  },

  // ── Dashboard (Phase 8B) ────────────────────────────────
  '/dashboard/summary': {
    get: {
      tags: ['Dashboard'], summary: 'Executive dashboard aggregation',
      parameters: [
        { name: 'scope', in: 'query', schema: { type: 'string' } },
        { name: 'catalog', in: 'query', schema: { type: 'string' } },
        { name: 'trendDays', in: 'query', schema: { type: 'integer', default: 90 } },
      ],
      responses: { 200: ok200('DashboardSummary'), 404: ERROR_404 },
    },
  },

  // ── Monitoring (Phase 8D) ───────────────────────────────
  '/monitoring/status': { get: { tags: ['Monitoring'], summary: 'Current posture findings + recent alerts', responses: { 200: okObject() } } },
  '/monitoring/run': { post: { tags: ['Monitoring'], summary: 'Run posture monitor on demand', responses: { 200: okObject() } } },
  '/monitoring/thresholds': {
    get: { tags: ['Monitoring'], summary: 'List configured thresholds', responses: { 200: okArray('MonitoringThresholds') } },
    put: { tags: ['Monitoring'], summary: 'Upsert monitoring thresholds', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MonitoringThresholds' } } } }, responses: { 200: ok200('MonitoringThresholds'), 400: ERROR_400 } },
  },
  '/monitoring/thresholds/resolve': {
    get: {
      tags: ['Monitoring'], summary: 'Resolve effective thresholds for a scope+catalog',
      parameters: [
        { name: 'scope', in: 'query', schema: { type: 'string' } },
        { name: 'catalog', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: ok200('MonitoringThresholds'), 400: ERROR_400, 404: ERROR_404 },
    },
  },
  '/monitoring/thresholds/{id}': {
    delete: { tags: ['Monitoring'], summary: 'Delete a threshold row', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObject() } },
  },

  // ── Evidence (Phase 8E) ─────────────────────────────────
  '/evidence': {
    get: {
      tags: ['Evidence'], summary: 'List evidence with filters',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'implementation_id', in: 'query', schema: { type: 'string' } },
        { name: 'expiring_within_days', in: 'query', schema: { type: 'integer' } },
      ],
      responses: { 200: okArray('Evidence') },
    },
    post: { tags: ['Evidence'], summary: 'Create evidence (draft)', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Evidence' } } } }, responses: { 201: ok200('Evidence'), 400: ERROR_400 } },
  },
  '/evidence/freshness': { get: { tags: ['Evidence'], summary: 'Cross-catalog freshness summary', responses: { 200: okObject() } } },
  '/evidence/sweep': { post: { tags: ['Evidence'], summary: 'Force an expiry sweep run', responses: { 200: okObject() } } },
  '/evidence/{id}': {
    get: { tags: ['Evidence'], summary: 'Evidence detail + history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok200('Evidence'), 404: ERROR_404 } },
    put: { tags: ['Evidence'], summary: 'Update metadata', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Evidence' } } } }, responses: { 200: ok200('Evidence'), 400: ERROR_400, 404: ERROR_404 } },
  },
  '/evidence/{id}/transition': {
    post: {
      tags: ['Evidence'], summary: 'Apply a lifecycle state transition',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['action'],
              properties: {
                action: { type: 'string', enum: ['submit', 'review', 'accept', 'reject', 'revise', 'renew', 'archive'] },
                reviewer_id: { type: 'string' },
                notes: { type: 'string' },
                renewal_period_days: { type: 'integer' },
                valid_until: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      responses: { 200: ok200('Evidence'), 400: ERROR_400, 404: ERROR_404, 409: ERROR_409 },
    },
  },

  // ── Reports (Phase 8C) ──────────────────────────────────
  '/reports/audit/preview': {
    get: {
      tags: ['Reports'], summary: 'Preview audit report data as JSON',
      parameters: [
        { name: 'scope', in: 'query', schema: { type: 'string' } },
        { name: 'catalog', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'trend_days', in: 'query', schema: { type: 'integer', default: 90 } },
      ],
      responses: { 200: okObject(), 400: ERROR_400, 404: ERROR_404 },
    },
  },
  '/reports/audit': {
    get: {
      tags: ['Reports'], summary: 'Download audit report as PDF or DOCX',
      parameters: [
        { name: 'scope', in: 'query', schema: { type: 'string' } },
        { name: 'catalog', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'format', in: 'query', schema: { type: 'string', enum: ['pdf', 'docx'], default: 'pdf' } },
        { name: 'trend_days', in: 'query', schema: { type: 'integer', default: 90 } },
      ],
      responses: {
        200: {
          description: 'Generated report (binary)',
          content: {
            'application/pdf': { schema: { type: 'string', format: 'binary' } },
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { schema: { type: 'string', format: 'binary' } },
          },
        },
        400: ERROR_400, 404: ERROR_404, 500: ERROR_500,
      },
    },
  },
};
