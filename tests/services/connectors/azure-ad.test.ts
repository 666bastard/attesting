import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  AzureAdAdapter,
  mapSeverity,
  classifyThreatType,
} from '../../../src/services/connectors/adapters/azure-ad.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function tokenResponse(token = 'aad-tok-1', expiresIn = 3600): Response {
  return jsonResponse({ access_token: token, expires_in: expiresIn, token_type: 'Bearer' });
}

const CONFIG = {
  tenant_id: 'tenant-abc',
  client_id: 'client-1',
  client_secret: 'secret-1',
};

function makeDetection(overrides: Record<string, any> = {}): any {
  return {
    id: 'rd-1',
    requestId: 'req-1',
    userId: 'u-1',
    userPrincipalName: 'alice@acme.com',
    userDisplayName: 'Alice',
    ipAddress: '203.0.113.7',
    location: { countryOrRegion: 'US', city: 'Seattle' },
    riskLevel: 'high',
    riskEventType: 'unfamiliarFeatures',
    riskState: 'atRisk',
    detectionTimingType: 'realtime',
    detectedDateTime: '2026-04-05T10:00:00Z',
    activity: 'signin',
    source: 'IdentityProtection',
    ...overrides,
  };
}

describe('AzureAdAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'AzureAdAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('pure helpers', () => {
    it('mapSeverity handles Entra risk levels', () => {
      expect(mapSeverity('high')).toBe('high');
      expect(mapSeverity('medium')).toBe('medium');
      expect(mapSeverity('low')).toBe('low');
      expect(mapSeverity('hidden')).toBe('info');
      expect(mapSeverity('none')).toBe('info');
      expect(mapSeverity(undefined)).toBe('medium');
    });

    it('mapSeverity only emits CHECK-compliant values', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      for (const r of ['high', 'medium', 'low', 'hidden', 'none', 'weird', null]) {
        expect(allowed.has(mapSeverity(r))).toBe(true);
      }
    });

    it('classifyThreatType maps riskEventType to CHECK values', () => {
      expect(classifyThreatType('leakedCredentials')).toBe('exploit');
      expect(classifyThreatType('passwordSpray')).toBe('exploit');
      expect(classifyThreatType('maliciousIPAddress')).toBe('campaign');
      expect(classifyThreatType('anonymizedIPAddress')).toBe('campaign');
      expect(classifyThreatType('malwareLinkedIpAddress')).toBe('malware');
      expect(classifyThreatType('impossibleTravel')).toBe('ttp');
      expect(classifyThreatType('unfamiliarFeatures')).toBe('ttp');
      expect(classifyThreatType('suspiciousInboxManipulation')).toBe('ttp');
      expect(classifyThreatType('investigationsThreatIntelligence')).toBe('campaign');
      expect(classifyThreatType('unknown')).toBe('advisory');
    });
  });

  describe('transform', () => {
    it('maps a risk detection to a threat_inputs entity', () => {
      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      const result = adapter.transform(makeDetection())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('rd-1');
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('ttp');
      expect(result.severity).toBe('high');
      expect(result.source_name).toBe('Microsoft Entra ID');
      expect(result.title).toContain('unfamiliarFeatures');
      expect(result.title).toContain('high');
      expect(result.description).toContain('alice@acme.com');
      expect(result.description).toContain('203.0.113.7');
      expect(result.description).toContain('Seattle');
      expect(result.description).toContain('US');
      expect(result.description).toContain('atRisk');
      expect(JSON.parse(result.affected_platforms)).toContain('geo:US');
      expect(JSON.parse(result.affected_products)).toContain('203.0.113.7');

      const iocs = JSON.parse(result.iocs);
      expect(iocs.user.principal).toBe('alice@acme.com');
      expect(iocs.client.ip).toBe('203.0.113.7');
      expect(iocs.riskLevel).toBe('high');
      expect(iocs.riskState).toBe('atRisk');
      expect(iocs.riskEventType).toBe('unfamiliarFeatures');
    });

    it('transform output satisfies all threat_inputs CHECK constraints across risk levels', () => {
      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      const fixtures: Array<[string, string]> = [
        ['high', 'leakedCredentials'],
        ['medium', 'impossibleTravel'],
        ['low', 'unfamiliarFeatures'],
        ['hidden', 'anonymizedIPAddress'],
        ['none', 'passwordSpray'],
      ];
      for (const [riskLevel, riskEventType] of fixtures) {
        const result = adapter.transform(makeDetection({ riskLevel, riskEventType }))!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when detection has no id', () => {
      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      expect(adapter.transform({ riskLevel: 'high' })).toBeNull();
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when required config missing', () => {
      expect(() => new AzureAdAdapter(db, connectorId, { tenant_id: 'x' })).toThrow(/client_id|client_secret/);
    });

    it('authenticates with OAuth2 client_credentials then queries Graph', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ value: [makeDetection()] }));

      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);
      expect(results).toHaveLength(1);

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
      expect(String(tokenUrl)).toBe('https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token');
      expect(tokenInit.method).toBe('POST');
      const tokenBody = String(tokenInit.body);
      expect(tokenBody).toContain('client_id=client-1');
      expect(tokenBody).toContain('grant_type=client_credentials');
      expect(decodeURIComponent(tokenBody)).toContain('scope=https://graph.microsoft.com/.default');

      const [graphUrl, graphInit] = fetchMock.mock.calls[1];
      expect(String(graphUrl)).toContain('https://graph.microsoft.com/v1.0/identityProtection/riskDetections');
      expect(graphInit.headers.Authorization).toBe('Bearer aad-tok-1');

      const decoded = decodeURIComponent(String(graphUrl)).replace(/\+/g, ' ');
      expect(decoded).toContain("(riskState eq 'atRisk')");
      expect(decoded).toContain("(riskState eq 'confirmedCompromised')");
      expect(decoded).toContain('$orderby=detectedDateTime asc');
    });

    it('adds detectedDateTime filter on incremental sync', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ value: [] }));

      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const url = decodeURIComponent(String(fetchMock.mock.calls[1][0])).replace(/\+/g, ' ');
      expect(url).toContain('detectedDateTime ge 2026-04-01T00:00:00.000Z');
    });

    it('follows @odata.nextLink to paginate', async () => {
      const next = 'https://graph.microsoft.com/v1.0/identityProtection/riskDetections?$skiptoken=abc';
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({
          value: [makeDetection({ id: 'rd-1' })],
          '@odata.nextLink': next,
        }))
        .mockResolvedValueOnce(jsonResponse({ value: [makeDetection({ id: 'rd-2' })] }));

      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);
      expect(results).toHaveLength(2);
      expect(String(fetchMock.mock.calls[2][0])).toBe(next);
    });

    it('refreshes token and retries on 401', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse('tok-1'))
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(tokenResponse('tok-2'))
        .mockResolvedValueOnce(jsonResponse({ value: [] }));

      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      await adapter.fetch(null);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer tok-2');
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ value: [] }));

      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(1500);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('surfaces non-retryable 5xx errors', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));

      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });

    it('surfaces auth failures with a clear message', async () => {
      fetchMock.mockResolvedValueOnce(new Response('bad creds', { status: 403 }));
      const adapter = new AzureAdAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'AzureAdAdapter',
        config: { tenant_id: 't', client_id: 'c', client_secret: 's' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(AzureAdAdapter);
    });
  });
});
