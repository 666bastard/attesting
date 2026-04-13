import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  SplunkAdapter,
  mapSeverity,
  classifyThreatType,
  extractCveId,
  extractTtps,
} from '../../../src/services/connectors/adapters/splunk.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const CONFIG = {
  base_url: 'https://splunk.acme.com:8089',
  token: 'splunk-tok-abc',
};

function makeEvent(overrides: Record<string, any> = {}): any {
  return {
    event_id: 'ev-1',
    search_name: 'Access - Excessive Failed Logins',
    signature: 'Brute force attempt on admin panel',
    urgency: 'high',
    severity: 'high',
    src: '10.0.0.5',
    dest: 'auth-server',
    security_domain: 'access',
    dvc: 'firewall-01',
    _time: '2026-04-05T10:00:00Z',
    _raw: 'failed login for user=admin src=10.0.0.5',
    annotations: { mitre_attack: ['T1110'] },
    ...overrides,
  };
}

describe('SplunkAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'SplunkAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('pure helpers', () => {
    it('mapSeverity handles Splunk urgency labels', () => {
      expect(mapSeverity('critical')).toBe('critical');
      expect(mapSeverity('high')).toBe('high');
      expect(mapSeverity('medium')).toBe('medium');
      expect(mapSeverity('low')).toBe('low');
      expect(mapSeverity('informational')).toBe('info');
      expect(mapSeverity(undefined)).toBe('medium');
    });

    it('mapSeverity only emits CHECK-compliant values', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      for (const u of ['critical', 'high', 'medium', 'low', 'informational', 'weird', null]) {
        expect(allowed.has(mapSeverity(u))).toBe(true);
      }
    });

    it('classifyThreatType picks from event metadata', () => {
      expect(classifyThreatType({ security_domain: 'endpoint' })).toBe('malware');
      expect(classifyThreatType({ signature: 'CVE-2024-1 exploit' })).toBe('exploit');
      expect(classifyThreatType({ signature: 'CVE-2024-1' })).toBe('vulnerability');
      expect(classifyThreatType({ security_domain: 'network' })).toBe('ttp');
      expect(classifyThreatType({})).toBe('advisory');
    });

    it('extractCveId finds CVEs in event fields', () => {
      expect(extractCveId({ signature: 'Exploit for CVE-2024-1234' })).toBe('CVE-2024-1234');
      expect(extractCveId({ _raw: 'cve-2023-99999 detected' })).toBe('CVE-2023-99999');
      expect(extractCveId({})).toBeNull();
    });

    it('extractTtps normalizes MITRE fields', () => {
      expect(extractTtps({ annotations: { mitre_attack: ['T1110', 'T1078'] } })).toEqual(['T1110', 'T1078']);
      expect(extractTtps({ mitre_technique: 'T1059' })).toEqual(['T1059']);
      expect(extractTtps({})).toEqual([]);
    });
  });

  describe('transform', () => {
    it('maps a notable event to a threat_inputs entity', () => {
      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const result = adapter.transform(makeEvent())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('ev-1');
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('ttp');
      expect(result.severity).toBe('high');
      expect(result.source_name).toBe('Splunk');
      expect(result.title).toContain('Access - Excessive Failed Logins');
      expect(JSON.parse(result.affected_platforms)).toContain('access');
      expect(JSON.parse(result.affected_products)).toContain('10.0.0.5');
      expect(JSON.parse(result.ttps)).toEqual(['T1110']);

      const iocs = JSON.parse(result.iocs);
      expect(iocs.src).toBe('10.0.0.5');
      expect(iocs.dest).toBe('auth-server');
      expect(iocs.urgency).toBe('high');
    });

    it('transform output satisfies all threat_inputs CHECK constraints across urgencies', () => {
      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      for (const u of ['critical', 'high', 'medium', 'low', 'informational']) {
        const result = adapter.transform(makeEvent({ urgency: u }))!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when event has no id/time/signature', () => {
      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      expect(adapter.transform({})).toBeNull();
    });

    it('falls back to search_name:_time when event_id missing', () => {
      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const result = adapter.transform({
        search_name: 'rule-A',
        _time: '2026-04-01T00:00:00Z',
        urgency: 'medium',
      })!;
      expect(result.external_id).toBe('rule-A:2026-04-01T00:00:00Z');
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when required config missing', () => {
      expect(() => new SplunkAdapter(db, connectorId, { base_url: 'x' })).toThrow(/token/);
    });

    it('creates job, polls DONE, and fetches results', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-1' }))
        .mockResolvedValueOnce(
          jsonResponse({ entry: [{ content: { dispatchState: 'DONE' } }] }),
        )
        .mockResolvedValueOnce(jsonResponse({ results: [makeEvent()] }));

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const [createUrl, createInit] = fetchMock.mock.calls[0];
      expect(String(createUrl)).toBe('https://splunk.acme.com:8089/services/search/jobs');
      expect(createInit.method).toBe('POST');
      expect(createInit.headers.Authorization).toBe('Bearer splunk-tok-abc');
      const createBody = String(createInit.body);
      expect(createBody).toContain('search=search+index%3Dnotable');
      expect(createBody).toContain('output_mode=json');
      expect(createBody).toContain('earliest_time=-24h');
      expect(createBody).toContain('latest_time=now');

      expect(String(fetchMock.mock.calls[1][0])).toContain('/services/search/jobs/SID-1');
      expect(String(fetchMock.mock.calls[2][0])).toContain('/services/search/jobs/SID-1/results');
    });

    it('supports custom SPL', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-2' }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'DONE' } }] }))
        .mockResolvedValueOnce(jsonResponse({ results: [] }));

      const adapter = new SplunkAdapter(db, connectorId, {
        ...CONFIG,
        spl: 'search index=firewall action=blocked',
      });
      await adapter.fetch(null);

      const body = decodeURIComponent(String(fetchMock.mock.calls[0][1].body)).replace(/\+/g, ' ');
      expect(body).toContain('index=firewall action=blocked');
    });

    it('passes earliest_time from since on incremental sync', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-3' }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'DONE' } }] }))
        .mockResolvedValueOnce(jsonResponse({ results: [] }));

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const body = decodeURIComponent(String(fetchMock.mock.calls[0][1].body));
      expect(body).toContain('earliest_time=2026-04-01T00:00:00.000Z');
    });

    it('polls multiple times until DONE', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-4' }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'PARSING' } }] }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'RUNNING' } }] }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'DONE' } }] }))
        .mockResolvedValueOnce(jsonResponse({ results: [] }));

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(20_000);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('throws when job enters FAILED state', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-5' }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'FAILED' } }] }));

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/FAILED/);
    });

    it('times out when job never completes', async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async (url: any) => {
        if (String(url).endsWith('/search/jobs')) return jsonResponse({ sid: 'SID-6' });
        return jsonResponse({ entry: [{ content: { dispatchState: 'RUNNING' } }] });
      });

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      const caught = promise.catch(e => e);
      await vi.advanceTimersByTimeAsync(60_000);
      const err = await caught;
      expect(String(err)).toMatch(/did not complete/);
    });

    it('paginates results via offset/count', async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => makeEvent({ event_id: `e${i}` }));
      const page2 = [makeEvent({ event_id: 'e500' })];

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-7' }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'DONE' } }] }))
        .mockResolvedValueOnce(jsonResponse({ results: page1 }))
        .mockResolvedValueOnce(jsonResponse({ results: page2 }));

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(501);
      expect(String(fetchMock.mock.calls[2][0])).toContain('offset=0');
      expect(String(fetchMock.mock.calls[3][0])).toContain('offset=500');
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ sid: 'SID-8' }))
        .mockResolvedValueOnce(jsonResponse({ entry: [{ content: { dispatchState: 'DONE' } }] }))
        .mockResolvedValueOnce(jsonResponse({ results: [] }));

      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('surfaces 401 auth errors clearly', async () => {
      fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });

    it('surfaces 5xx errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const adapter = new SplunkAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'SplunkAdapter',
        config: { base_url: 'https://splunk.acme.com:8089', token: 't' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(SplunkAdapter);
    });
  });
});
