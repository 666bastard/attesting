/**
 * Phase 5J — OpenAPI 3.1 specification for the Attesting HTTP API.
 *
 * Structured as a plain JS object (not YAML) so it can be imported directly
 * by Express routes, validated at runtime, and shipped in the build output
 * without requiring a YAML parser dependency. Served at:
 *
 *   GET /api/docs              → Swagger UI (HTML)
 *   GET /api/docs/openapi.json → raw spec
 *
 * The spec is split across two files so each stays under the 300-line
 * target: this file holds the document skeleton + reusable component
 * schemas, and `./openapi-paths.ts` holds the per-route path definitions.
 */

import { OPENAPI_PATHS } from './openapi-paths.js';

export const OPENAPI_VERSION = '3.1.0';

export function buildOpenApiSpec(packageVersion: string = '0.4.0'): Record<string, any> {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'Attesting API',
      version: packageVersion,
      summary: 'OSCAL-native GRC platform — controls, compliance, risk, evidence, monitoring.',
      description: [
        'Attesting maps security controls across frameworks, tracks implementation state,',
        'scores compliance posture, monitors drift, and generates audit reports.',
        '',
        'All endpoints are namespaced under `/api`. Rate limiting is applied globally',
        '(100 requests per 60 seconds). Errors follow a consistent envelope:',
        '`{ error, code, status, details?, stack? }`.',
      ].join('\n'),
      license: { name: 'MIT', identifier: 'MIT' },
      contact: {
        name: 'Attesting',
        url: 'https://github.com/xtonyknucklesx/attesting',
      },
    },
    servers: [
      { url: 'http://localhost:3000/api', description: 'Local development' },
    ],
    tags: [
      { name: 'Organization', description: 'Org profile + scopes' },
      { name: 'Catalogs', description: 'Control catalogs (frameworks)' },
      { name: 'Mappings', description: 'Cross-framework control mappings' },
      { name: 'Implementations', description: 'Control implementation statements' },
      { name: 'Coverage', description: 'Implementation coverage aggregates' },
      { name: 'Diff', description: 'Catalog diff' },
      { name: 'Export', description: 'Export compliance data (CSV, OSCAL, SIG, SOA, PDF)' },
      { name: 'Watches', description: 'Framework watch registrations' },
      { name: 'Governance', description: 'Policies, committees, roles' },
      { name: 'Risk', description: 'Risk register, matrix, exceptions' },
      { name: 'Intel', description: 'Threat intelligence + manual intel' },
      { name: 'Drift', description: 'Drift alerts + dispositions' },
      { name: 'Assets', description: 'Asset inventory' },
      { name: 'Connectors', description: 'External data connectors' },
      { name: 'Owners', description: 'Owner/person directory' },
      { name: 'Audit', description: 'Audit log queries' },
      { name: 'Import', description: 'Proprietary catalog import' },
      { name: 'Onboarding', description: 'Initial setup flow' },
      { name: 'Scores', description: 'Compliance scoring (Phase 8A)' },
      { name: 'Dashboard', description: 'Executive dashboard aggregator (Phase 8B)' },
      { name: 'Reports', description: 'Audit-ready PDF / DOCX reports (Phase 8C)' },
      { name: 'Monitoring', description: 'Continuous posture monitoring (Phase 8D)' },
      { name: 'Evidence', description: 'Evidence lifecycle (Phase 8E)' },
    ],
    components: {
      schemas: {
        // ── Error envelope (from error-handler.ts) ───────────
        ErrorResponse: {
          type: 'object',
          required: ['error', 'code', 'status'],
          properties: {
            error: { type: 'string', description: 'Human-readable error message' },
            code: { type: 'string', description: 'Stable error code (e.g. bad_request, not_found)' },
            status: { type: 'integer', description: 'HTTP status code' },
            details: { type: 'string', description: 'Optional diagnostic detail' },
            stack: { type: 'string', description: 'Stack trace (non-production only)' },
          },
        },

        // ── Core domain shapes ───────────────────────────────
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Scope: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            org_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            scope_type: { type: 'string' },
          },
        },
        Catalog: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            short_name: { type: 'string' },
            source_format: { type: 'string' },
            total_controls: { type: 'integer' },
          },
        },
        Control: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            catalog_id: { type: 'string', format: 'uuid' },
            control_id: { type: 'string', description: 'Native control ID (e.g. AC-2)' },
            title: { type: 'string' },
            description: { type: 'string' },
            family: { type: 'string', nullable: true },
          },
        },
        Mapping: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            source_control_id: { type: 'string' },
            target_control_id: { type: 'string' },
            relationship: { type: 'string', enum: ['equivalent', 'superset', 'subset', 'related', 'intersects'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
        Implementation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            org_id: { type: 'string', format: 'uuid' },
            scope_id: { type: 'string', format: 'uuid', nullable: true },
            primary_control_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['implemented', 'partially-implemented', 'planned', 'alternative', 'not-applicable', 'not-implemented'],
            },
            statement: { type: 'string' },
            responsible_role: { type: 'string', nullable: true },
            responsible_person: { type: 'string', nullable: true },
          },
        },
        Evidence: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            implementation_id: { type: 'string', format: 'uuid', nullable: true },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            evidence_type: { type: 'string' },
            status: {
              type: 'string',
              enum: ['draft', 'submitted', 'reviewed', 'accepted', 'rejected', 'expiring', 'expired', 'archived'],
            },
            reviewer_id: { type: 'string', nullable: true },
            reviewed_at: { type: 'string', format: 'date-time', nullable: true },
            valid_from: { type: 'string', format: 'date-time', nullable: true },
            valid_until: { type: 'string', format: 'date-time', nullable: true },
            renewal_period_days: { type: 'integer', nullable: true },
            version: { type: 'integer' },
            previous_version_id: { type: 'string', format: 'uuid', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        EvidenceFreshness: {
          type: 'string',
          enum: ['fresh', 'expiring_soon', 'expired', 'pending', 'rejected', 'archived'],
        },
        Risk: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            risk_id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            likelihood: { type: 'integer', minimum: 1, maximum: 5 },
            impact: { type: 'integer', minimum: 1, maximum: 5 },
            inherent_risk_score: { type: 'integer' },
            residual_risk_score: { type: 'integer', nullable: true },
            owner: { type: 'string' },
            status: { type: 'string', enum: ['open', 'closed', 'mitigated', 'accepted'] },
          },
        },
        DriftAlert: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            alert_type: { type: 'string' },
            severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
            title: { type: 'string' },
            message: { type: 'string', nullable: true },
            source_entity_type: { type: 'string' },
            source_entity_id: { type: 'string' },
            resolved_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Asset: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            asset_type: { type: 'string' },
            platform: { type: 'string', nullable: true },
            criticality: { type: 'string', nullable: true },
            status: { type: 'string' },
          },
        },
        Connector: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            connector_type: { type: 'string' },
            adapter_class: { type: 'string' },
            is_enabled: { type: 'integer' },
            health_status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy', 'unknown'] },
            last_sync_at: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        ComplianceScore: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            scope_id: { type: 'string', format: 'uuid', nullable: true },
            catalog_id: { type: 'string', format: 'uuid' },
            overall_score: { type: 'number' },
            coverage_score: { type: 'number', nullable: true },
            evidence_score: { type: 'number', nullable: true },
            assessment_score: { type: 'number', nullable: true },
            coverage_weight: { type: 'number' },
            evidence_weight: { type: 'number' },
            assessment_weight: { type: 'number' },
            total_controls: { type: 'integer' },
            implemented_count: { type: 'integer' },
            family_breakdown: { type: 'array', items: { $ref: '#/components/schemas/FamilyBreakdown' } },
            calculated_at: { type: 'string', format: 'date-time' },
          },
        },
        FamilyBreakdown: {
          type: 'object',
          properties: {
            family: { type: 'string' },
            total: { type: 'integer' },
            implemented: { type: 'integer' },
            partial: { type: 'integer' },
            not_applicable: { type: 'integer' },
            score: { type: 'number' },
          },
        },
        MonitoringThresholds: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            scope_id: { type: 'string', format: 'uuid', nullable: true },
            catalog_id: { type: 'string', format: 'uuid', nullable: true },
            warning_threshold: { type: 'number' },
            critical_threshold: { type: 'number' },
            delta_warning: { type: 'number' },
            delta_critical: { type: 'number' },
            trend_window: { type: 'integer' },
            enabled: { type: 'boolean' },
          },
        },
        PostureFinding: {
          type: 'object',
          properties: {
            scope_id: { type: 'string', format: 'uuid', nullable: true },
            catalog_id: { type: 'string', format: 'uuid' },
            catalog_short_name: { type: 'string', nullable: true },
            current_score: { type: 'number' },
            previous_score: { type: 'number', nullable: true },
            threshold_breached: { type: 'boolean' },
            delta: { type: 'number', nullable: true },
            delta_breached: { type: 'boolean' },
            consecutive_drops: { type: 'integer' },
            trend_breached: { type: 'boolean' },
            alert_ids: { type: 'array', items: { type: 'string' } },
          },
        },
        DashboardSummary: {
          type: 'object',
          properties: {
            scope: { type: 'object' },
            compliance: { type: 'object' },
            frameworks: { type: 'array', items: { type: 'object' } },
            trend: { type: 'object' },
            coverage: { type: 'object' },
            risk: { type: 'object' },
            drift: { type: 'object' },
            evidence: { type: 'object' },
            poam: { type: 'object' },
            generated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
      responses: {
        NotFound: {
          description: 'Not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        BadRequest: {
          description: 'Invalid request',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        Conflict: {
          description: 'State conflict',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        ServerError: {
          description: 'Internal server error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
      parameters: {
        ScopeRef: {
          name: 'scopeRef',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Scope name, UUID, or "org" for organization-wide',
        },
        CatalogRef: {
          name: 'catalogRef',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'Catalog short_name or UUID',
        },
      },
    },
    paths: OPENAPI_PATHS,
  };
}
