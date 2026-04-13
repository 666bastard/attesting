import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  CrowdStrikeAdapter,
  mapSeverity,
  extractCveId,
  extractPlatforms,
  extractProducts,
  extractTtps,
} from '../../../src/services/connectors/adapters/crowdstrike.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function tokenResponse(token = 'tok-123', expiresIn = 1800): Response {
  return jsonResponse({ access_token: token, expires_in: expiresIn, token_type: 'bearer' });
}

describe('CrowdStrikeAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'CrowdStrikeAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('pure helpers', () => {
    it('mapSeverity maps numeric scores and strings', () => {
      expect(mapSeverity(95)).toBe('critical');
      expect(mapSeverity(75)).toBe('high');
      expect(mapSeverity(50)).toBe('medium');
      expect(mapSeverity(25)).toBe('low');
      expect(mapSeverity(5)).toBe('info');
      expect(mapSeverity('Critical')).toBe('critical');
      expect(mapSeverity('HIGH')).toBe('high');
      expect(mapSeverity('medium')).toBe('medium');
      expect(mapSeverity('low')).toBe('low');
      expect(mapSeverity(undefined)).toBe('medium');
    });

    it('extractCveId pulls CVE from behaviors', () => {
      expect(
        extractCveId({
          behaviors: [{ technique: 'Exploit for CVE-2024-1234 in Chrome' }],
        }),
      ).toBe('CVE-2024-1234');
      expect(
        extractCveId({ description: 'relates to cve-2023-99999' }),
      ).toBe('CVE-2023-99999');
      expect(extractCveId({ behaviors: [{ technique: 'Living off the land' }] })).toBeNull();
    });

    it('extractPlatforms pulls device + behavior platforms', () => {
      const platforms = extractPlatforms({
        device: { platform_name: 'Windows', os_version: 'Windows 10' },
        behaviors: [{ platform_name: 'Windows' }],
      });
      expect(platforms).toContain('windows');
      expect(platforms).toContain('Windows 10');
    });

    it('extractProducts pulls file metadata', () => {
      const products = extractProducts({
        behaviors: [{ filename: 'mimikatz.exe', filepath: 'C:\\temp\\mimikatz.exe' }],
        device: { product_type_desc: 'Workstation' },
      });
      expect(products).toContain('mimikatz.exe');
      expect(products).toContain('Workstation');
    });

    it('extractTtps captures MITRE techniques', () => {
      const ttps = extractTtps({
        behaviors: [
          { technique: 'Credential Dumping', tactic: 'Credential Access' },
          { technique_id: 'T1059' },
        ],
      });
      expect(ttps).toHaveLength(2);
      expect(ttps[0]).toEqual({ technique: 'Credential Dumping', tactic: 'Credential Access' });
    });
  });

  describe('transform', () => {
    it('maps a detection to a threat_inputs entity', () => {
      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      const detection = {
        detection_id: 'ldt:abc:123',
        max_severity_displayname: 'High',
        description: 'Suspicious PowerShell',
        behaviors: [
          { technique: 'Exploit CVE-2024-5555', tactic: 'Execution', filename: 'pwsh.exe' },
        ],
        device: { platform_name: 'Windows', product_type_desc: 'Server' },
      };

      const result = adapter.transform(detection)!;
      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('ldt:abc:123');
      expect(result.external_source).toBe(connectorId);
      expect(result.channel).toBe('vendor_advisory');
      expect(result.threat_type).toBe('ttp');
      expect(result.severity).toBe('high');
      expect(result.cve_id).toBe('CVE-2024-5555');
      expect(result.source_name).toBe('CrowdStrike Falcon');
      expect(result.title).toContain('ldt:abc:123');
      expect(JSON.parse(result.affected_platforms)).toContain('windows');
      expect(JSON.parse(result.ttps)).toHaveLength(1);
    });

    it('returns null when detection has no id', () => {
      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      expect(adapter.transform({ behaviors: [] })).toBeNull();
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when credentials missing', () => {
      expect(() => new CrowdStrikeAdapter(db, connectorId, {})).toThrow(/client_id/);
    });

    it('authenticates, queries IDs, then posts for summaries', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          jsonResponse({
            resources: ['ldt:1', 'ldt:2'],
            meta: { pagination: { total: 2 } },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            resources: [
              { detection_id: 'ldt:1', max_severity_displayname: 'Critical', behaviors: [] },
              { detection_id: 'ldt:2', max_severity_displayname: 'Low', behaviors: [] },
            ],
          }),
        );

      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
      expect(String(tokenUrl)).toContain('/oauth2/token');
      expect(tokenInit.method).toBe('POST');

      const [queryUrl] = fetchMock.mock.calls[1];
      expect(String(queryUrl)).toContain('/detects/queries/detects/v1');
      expect(String(queryUrl)).toContain('limit=500');
      expect(String(queryUrl)).toContain('offset=0');

      const [summaryUrl, summaryInit] = fetchMock.mock.calls[2];
      expect(String(summaryUrl)).toContain('/detects/entities/summaries/GET/v1');
      expect(summaryInit.method).toBe('POST');
      const body = JSON.parse(summaryInit.body as string);
      expect(body.ids).toEqual(['ldt:1', 'ldt:2']);
    });

    it('passes since as last_behavior filter', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ resources: [], meta: { pagination: { total: 0 } } }));

      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      await adapter.fetch('2026-01-01T00:00:00.000Z');

      const queryUrl = String(fetchMock.mock.calls[1][0]);
      expect(queryUrl).toContain('filter=');
      expect(decodeURIComponent(queryUrl)).toContain("last_behavior:>='2026-01-01");
    });

    it('paginates when first page is full', async () => {
      const page1Ids = Array.from({ length: 500 }, (_, i) => `ldt:${i}`);
      const page2Ids = ['ldt:500', 'ldt:501'];

      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          jsonResponse({ resources: page1Ids, meta: { pagination: { total: 502 } } }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ resources: page2Ids, meta: { pagination: { total: 502 } } }),
        )
        .mockResolvedValueOnce(jsonResponse({ resources: [] }));

      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      await adapter.fetch(null);

      expect(String(fetchMock.mock.calls[1][0])).toContain('offset=0');
      expect(String(fetchMock.mock.calls[2][0])).toContain('offset=500');
    });

    it('refreshes token and retries on 401', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse('tok-1'))
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(tokenResponse('tok-2'))
        .mockResolvedValueOnce(jsonResponse({ resources: [], meta: { pagination: { total: 0 } } }));

      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      const results = await adapter.fetch(null);
      expect(results).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(4);

      const retriedHeaders = fetchMock.mock.calls[3][1].headers;
      expect(retriedHeaders.Authorization).toBe('Bearer tok-2');
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response('rate limited', {
            status: 429,
            headers: { 'Retry-After': '1' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ resources: [], meta: { pagination: { total: 0 } } }));

      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(1500);
      const results = await promise;

      expect(results).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('surfaces non-retryable API errors', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response('nope', { status: 500 }));

      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });

    it('surfaces auth failures', async () => {
      fetchMock.mockResolvedValueOnce(new Response('bad creds', { status: 403 }));
      const adapter = new CrowdStrikeAdapter(db, connectorId, {
        client_id: 'id', client_secret: 'sec',
      });
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'CrowdStrikeAdapter',
        config: { client_id: 'id', client_secret: 'sec' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(CrowdStrikeAdapter);
    });
  });
});
