import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  AwsSecurityHubAdapter,
  mapSeverity,
  classifyThreatType,
  extractCveId,
  buildFilters,
} from '../../../src/services/connectors/adapters/aws-security-hub.js';
import { signRequest } from '../../../src/services/connectors/utils/aws-sigv4.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const CONFIG = {
  region: 'us-east-1',
  access_key_id: 'AKIAEXAMPLE',
  secret_access_key: 'SECRETEXAMPLE',
};

function makeFinding(overrides: Record<string, any> = {}): any {
  return {
    Id: 'arn:aws:securityhub:us-east-1:123:finding/abc',
    Title: 'S3 bucket is public',
    Description: 'Bucket allows public read access',
    GeneratorId: 'aws-foundational-security-best-practices/v/1.0.0/S3.1',
    ProductName: 'Security Hub',
    SourceUrl: 'https://console.aws.amazon.com/securityhub',
    Severity: { Label: 'HIGH', Normalized: 70 },
    Types: ['Software and Configuration Checks/AWS Security Best Practices'],
    Resources: [
      { Id: 'arn:aws:s3:::my-bucket', Type: 'AwsS3Bucket' },
    ],
    RecordState: 'ACTIVE',
    Workflow: { Status: 'NEW' },
    Compliance: { Status: 'FAILED' },
    UpdatedAt: '2026-04-05T10:00:00.000Z',
    Remediation: { Recommendation: { Text: 'Block public access' } },
    ...overrides,
  };
}

describe('AwsSecurityHubAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'AwsSecurityHubAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('SigV4 signing', () => {
    it('produces a well-formed AWS4-HMAC-SHA256 Authorization header', () => {
      const signed = signRequest({
        method: 'POST',
        url: 'https://securityhub.us-east-1.amazonaws.com/findings',
        region: 'us-east-1',
        service: 'securityhub',
        body: '{"Filters":{}}',
        headers: { 'X-Amz-Target': 'SecurityHubAPIService.GetFindings' },
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'SECRETEXAMPLE',
        now: new Date('2026-04-05T10:00:00Z'),
      });
      const auth = signed.headers.Authorization;
      expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(auth).toContain('Credential=AKIAEXAMPLE/20260405/us-east-1/securityhub/aws4_request');
      expect(auth).toContain('SignedHeaders=');
      expect(auth).toMatch(/Signature=[0-9a-f]{64}/);
      expect(signed.headers['X-Amz-Date']).toBe('20260405T100000Z');
      expect(signed.headers['X-Amz-Content-Sha256']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('includes session token header when provided', () => {
      const signed = signRequest({
        method: 'POST',
        url: 'https://securityhub.us-east-1.amazonaws.com/findings',
        region: 'us-east-1',
        service: 'securityhub',
        body: '{}',
        accessKeyId: 'A', secretAccessKey: 'B',
        sessionToken: 'SESSION123',
        now: new Date('2026-04-05T10:00:00Z'),
      });
      expect(signed.headers['X-Amz-Security-Token']).toBe('SESSION123');
      expect(signed.headers.Authorization).toContain('x-amz-security-token');
    });

    it('signing is deterministic for same inputs', () => {
      const opts = {
        method: 'POST' as const,
        url: 'https://securityhub.us-east-1.amazonaws.com/findings',
        region: 'us-east-1',
        service: 'securityhub',
        body: '{"x":1}',
        accessKeyId: 'A', secretAccessKey: 'B',
        now: new Date('2026-04-05T10:00:00Z'),
      };
      expect(signRequest(opts).headers.Authorization)
        .toBe(signRequest(opts).headers.Authorization);
    });
  });

  describe('pure helpers', () => {
    it('mapSeverity handles all SeverityLabel values', () => {
      expect(mapSeverity('CRITICAL')).toBe('critical');
      expect(mapSeverity('HIGH')).toBe('high');
      expect(mapSeverity('MEDIUM')).toBe('medium');
      expect(mapSeverity('LOW')).toBe('low');
      expect(mapSeverity('INFORMATIONAL')).toBe('info');
    });

    it('mapSeverity falls back to Normalized score', () => {
      expect(mapSeverity(null, 95)).toBe('critical');
      expect(mapSeverity(null, 75)).toBe('high');
      expect(mapSeverity(null, 50)).toBe('medium');
      expect(mapSeverity(null, 5)).toBe('low');
      expect(mapSeverity(null, 0)).toBe('info');
    });

    it('mapSeverity only emits CHECK-compliant values', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      for (const l of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL', 'weird', null]) {
        expect(allowed.has(mapSeverity(l))).toBe(true);
      }
    });

    it('classifyThreatType maps ASFF namespaces to CHECK values', () => {
      expect(classifyThreatType(['TTPs/Initial Access/UnauthorizedAccess:EC2'])).toBe('ttp');
      expect(classifyThreatType(['Unusual Behaviors/User'])).toBe('ttp');
      expect(classifyThreatType(['Effects/Data Exfiltration'])).toBe('malware');
      expect(classifyThreatType(['Software and Configuration Checks/AWS Security Best Practices'])).toBe('vulnerability');
      expect(classifyThreatType(['Sensitive Data Identifications/PII'])).toBe('advisory');
      expect(classifyThreatType([])).toBe('advisory');
    });

    it('extractCveId finds CVEs in title/description/types', () => {
      expect(extractCveId({ Title: 'CVE-2024-1234 in package' })).toBe('CVE-2024-1234');
      expect(extractCveId({ Description: 'affected by cve-2023-0001' })).toBe('CVE-2023-0001');
      expect(extractCveId({ Types: ['CVE-2022-9999'] })).toBe('CVE-2022-9999');
      expect(extractCveId({})).toBeNull();
    });

    it('buildFilters applies defaults and UpdatedAt window', () => {
      const f = buildFilters(undefined, '2026-04-01T00:00:00.000Z');
      expect(f.RecordState[0].Value).toBe('ACTIVE');
      expect(f.WorkflowStatus).toHaveLength(2);
      expect(f.SeverityLabel[0].Comparison).toBe('NOT_EQUALS');
      expect(f.UpdatedAt[0].Start).toBe('2026-04-01T00:00:00.000Z');
      expect(f.UpdatedAt[0].End).toBeDefined();
    });

    it('buildFilters preserves user overrides', () => {
      const f = buildFilters(
        { SeverityLabel: [{ Value: 'CRITICAL', Comparison: 'EQUALS' }] },
        null,
      );
      expect(f.SeverityLabel[0].Value).toBe('CRITICAL');
      expect(f.RecordState).toBeDefined(); // default still applied
    });
  });

  describe('transform', () => {
    it('maps an ASFF finding to a threat_inputs entity', () => {
      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      const result = adapter.transform(makeFinding())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('arn:aws:securityhub:us-east-1:123:finding/abc');
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('vulnerability');
      expect(result.severity).toBe('high');
      expect(result.source_name).toBe('Security Hub');
      expect(result.title).toContain('S3 bucket is public');
      expect(JSON.parse(result.affected_platforms)).toContain('AwsS3Bucket');
      expect(JSON.parse(result.affected_products)).toContain('arn:aws:s3:::my-bucket');

      const iocs = JSON.parse(result.iocs);
      expect(iocs.compliance).toBe('FAILED');
      expect(iocs.workflowStatus).toBe('NEW');
      expect(iocs.recordState).toBe('ACTIVE');
      expect(iocs.remediation).toBe('Block public access');
      expect(iocs.resourceIds).toEqual(['arn:aws:s3:::my-bucket']);
    });

    it('transform output satisfies all threat_inputs CHECK constraints across severities', () => {
      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      for (const label of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL']) {
        const result = adapter.transform(makeFinding({ Severity: { Label: label, Normalized: 50 } }))!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when finding has no Id', () => {
      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      expect(adapter.transform({ Title: 'x' })).toBeNull();
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when required config missing', () => {
      expect(() => new AwsSecurityHubAdapter(db, connectorId, { region: 'us-east-1' }))
        .toThrow(/access_key_id|secret_access_key/);
    });

    it('signs POST /findings with SigV4 and sends default filters', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ Findings: [makeFinding()] }));

      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);
      expect(results).toHaveLength(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://securityhub.us-east-1.amazonaws.com/findings');
      expect(init.method).toBe('POST');

      const auth = init.headers.Authorization as string;
      expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(auth).toContain('/us-east-1/securityhub/aws4_request');
      expect(auth).toContain('SignedHeaders=');
      expect(init.headers['X-Amz-Target']).toBe('SecurityHubAPIService.GetFindings');
      expect(init.headers['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/);

      const body = JSON.parse(String(init.body));
      expect(body.Filters.RecordState[0].Value).toBe('ACTIVE');
      expect(body.Filters.WorkflowStatus).toHaveLength(2);
      expect(body.MaxResults).toBe(100);
    });

    it('applies UpdatedAt filter on incremental sync', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ Findings: [] }));

      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(body.Filters.UpdatedAt[0].Start).toBe('2026-04-01T00:00:00.000Z');
    });

    it('merges custom filters over defaults', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ Findings: [] }));

      const adapter = new AwsSecurityHubAdapter(db, connectorId, {
        ...CONFIG,
        filters: { SeverityLabel: [{ Value: 'CRITICAL', Comparison: 'EQUALS' }] },
      });
      await adapter.fetch(null);

      const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(body.Filters.SeverityLabel[0].Value).toBe('CRITICAL');
      expect(body.Filters.RecordState).toBeDefined();
    });

    it('follows NextToken pagination', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ Findings: [makeFinding({ Id: 'f1' })], NextToken: 'tok-2' }),
        )
        .mockResolvedValueOnce(jsonResponse({ Findings: [makeFinding({ Id: 'f2' })] }));

      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(2);
      const body2 = JSON.parse(String(fetchMock.mock.calls[1][1].body));
      expect(body2.NextToken).toBe('tok-2');
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          new Response('throttled', { status: 429, headers: { 'Retry-After': '1' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ Findings: [] }));

      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(1500);
      await promise;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces persistent 403 as auth failure', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))
        .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });

    it('surfaces 5xx errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const adapter = new AwsSecurityHubAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'AwsSecurityHubAdapter',
        config: { region: 'us-east-1', access_key_id: 'AKIAX', secret_access_key: 'SECRETX' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(AwsSecurityHubAdapter);
    });
  });
});
