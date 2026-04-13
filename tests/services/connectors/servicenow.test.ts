import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  ServiceNowAdapter,
  mapSeverity,
  pickValue,
  pickDisplay,
  formatSnDate,
} from '../../../src/services/connectors/adapters/servicenow.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const CONFIG = {
  instance_url: 'https://acme.service-now.com',
  username: 'user',
  password: 'pass',
};

function makeSnIncident(overrides: Record<string, any> = {}): any {
  return {
    sys_id: { value: 'sys-1', display_value: 'sys-1' },
    number: { value: 'INC0001', display_value: 'INC0001' },
    short_description: { value: 'Phishing reported', display_value: 'Phishing reported' },
    description: { value: 'User received suspicious email', display_value: 'User received suspicious email' },
    priority: { value: '2', display_value: '2 - High' },
    severity: { value: '2', display_value: '2 - Medium' },
    state: { value: '2', display_value: 'In Progress' },
    category: { value: 'security', display_value: 'Security' },
    subcategory: { value: 'phishing', display_value: 'Phishing' },
    assignment_group: { value: 'abc', display_value: 'SOC Team' },
    cmdb_ci: { value: 'ci-1', display_value: 'mail-server-01' },
    sys_updated_on: { value: '2026-04-01 12:00:00', display_value: '2026-04-01 12:00:00' },
    ...overrides,
  };
}

describe('ServiceNowAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'ServiceNowAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('pure helpers', () => {
    it('mapSeverity handles ServiceNow priorities (1..5)', () => {
      expect(mapSeverity('1')).toBe('critical');
      expect(mapSeverity('2')).toBe('high');
      expect(mapSeverity('3')).toBe('medium');
      expect(mapSeverity('4')).toBe('low');
      expect(mapSeverity('5')).toBe('info');
    });

    it('mapSeverity honors display labels like "2 - High"', () => {
      expect(mapSeverity({ value: '2', display_value: '2 - High' })).toBe('high');
      expect(mapSeverity({ value: '1', display_value: '1 - Critical' })).toBe('critical');
    });

    it('mapSeverity falls back to snSeverity then label heuristics', () => {
      expect(mapSeverity(null, '1')).toBe('critical');
      expect(mapSeverity('unknown', null)).toBe('medium');
      expect(mapSeverity('Critical')).toBe('critical');
    });

    it('mapSeverity only emits values allowed by threat_inputs CHECK', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      for (const p of ['1', '2', '3', '4', '5', null, 'weird']) {
        expect(allowed.has(mapSeverity(p))).toBe(true);
      }
    });

    it('pickValue extracts values from SN display_value=all shapes', () => {
      expect(pickValue({ value: 'abc', display_value: 'Abc' })).toBe('abc');
      expect(pickValue({ value: '', display_value: 'Abc' })).toBe('Abc');
      expect(pickValue('plain')).toBe('plain');
      expect(pickValue('')).toBeNull();
      expect(pickValue(null)).toBeNull();
    });

    it('pickDisplay prefers display_value', () => {
      expect(pickDisplay({ value: 'sys-1', display_value: 'SOC Team' })).toBe('SOC Team');
      expect(pickDisplay({ value: 'sys-1', display_value: '' })).toBe('sys-1');
    });

    it('formatSnDate converts ISO to SN format', () => {
      expect(formatSnDate('2026-04-01T12:00:00.000Z')).toBe('2026-04-01 12:00:00');
    });
  });

  describe('transform', () => {
    it('maps a security incident to a threat_inputs entity', () => {
      const adapter = new ServiceNowAdapter(db, connectorId, CONFIG);
      const result = adapter.transform(makeSnIncident())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('sys-1');
      expect(result.external_source).toBe(connectorId);
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('advisory');
      expect(result.severity).toBe('high');
      expect(result.source_name).toBe('ServiceNow ITSM');
      expect(result.title).toContain('INC0001');
      expect(result.title).toContain('Phishing');
      expect(JSON.parse(result.affected_platforms)).toEqual(['security', 'phishing']);
      expect(JSON.parse(result.affected_products)).toEqual(['mail-server-01']);

      const iocs = JSON.parse(result.iocs);
      expect(iocs.state).toBe('2');
      expect(iocs.assignment_group).toBe('SOC Team');
      expect(iocs.raw).toBeDefined();
    });

    it('transform output satisfies all threat_inputs CHECK constraints', () => {
      const adapter = new ServiceNowAdapter(db, connectorId, CONFIG);
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      for (const p of ['1', '2', '3', '4', '5']) {
        const result = adapter.transform(makeSnIncident({ priority: { value: p, display_value: p } }))!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when sys_id and number are missing', () => {
      const adapter = new ServiceNowAdapter(db, connectorId, CONFIG);
      expect(adapter.transform({ short_description: { value: 'x' } })).toBeNull();
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when required config missing', () => {
      expect(() => new ServiceNowAdapter(db, connectorId, { instance_url: 'x' }))
        .toThrow(/instance_url|username|password/);
    });

    it('probes security incident table first and queries it', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ result: [] }))
        .mockResolvedValueOnce(jsonResponse({ result: [makeSnIncident()] }));

      const adapter = new ServiceNowAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/now/table/sn_si_incident');
      expect(String(fetchMock.mock.calls[1][0])).toContain('/api/now/table/sn_si_incident');

      const init = fetchMock.mock.calls[0][1];
      expect(init.headers.Authorization).toMatch(/^Basic /);
      const decoded = Buffer.from(init.headers.Authorization.split(' ')[1], 'base64').toString();
      expect(decoded).toBe('user:pass');
    });

    it('falls back to generic incident table when sn_si_incident is unavailable', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('not found', { status: 404 }))
        .mockResolvedValueOnce(jsonResponse({ result: [makeSnIncident()] }));

      const adapter = new ServiceNowAdapter(db, connectorId, CONFIG);
      await adapter.fetch(null);

      expect(String(fetchMock.mock.calls[0][0])).toContain('sn_si_incident');
      expect(String(fetchMock.mock.calls[1][0])).toContain('/api/now/table/incident');
    });

    it('sends sys_updated_on filter on incremental sync', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ result: [] }))
        .mockResolvedValueOnce(jsonResponse({ result: [] }));

      const adapter = new ServiceNowAdapter(db, connectorId, { ...CONFIG, table: 'incident' });
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const url = String(fetchMock.mock.calls[0][0]);
      const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
      expect(decoded).toContain('sys_updated_on>2026-04-01 00:00:00');
      expect(decoded).toContain('ORDERBYsys_updated_on');
    });

    it('paginates via sysparm_offset until batch under limit', async () => {
      const page1 = Array.from({ length: 200 }, (_, i) => makeSnIncident({
        sys_id: { value: `sys-${i}`, display_value: `sys-${i}` },
      }));
      const page2 = [makeSnIncident({
        sys_id: { value: 'sys-200', display_value: 'sys-200' },
      })];

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ result: page1 }))
        .mockResolvedValueOnce(jsonResponse({ result: page2 }));

      const adapter = new ServiceNowAdapter(db, connectorId, { ...CONFIG, table: 'incident' });
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(201);
      expect(String(fetchMock.mock.calls[0][0])).toContain('sysparm_offset=0');
      expect(String(fetchMock.mock.calls[1][0])).toContain('sysparm_offset=200');
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ result: [] }));

      const adapter = new ServiceNowAdapter(db, connectorId, { ...CONFIG, table: 'incident' });
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(1500);
      const results = await promise;

      expect(results).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces 401 auth errors clearly', async () => {
      fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
      const adapter = new ServiceNowAdapter(db, connectorId, { ...CONFIG, table: 'incident' });
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });

    it('surfaces 5xx errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const adapter = new ServiceNowAdapter(db, connectorId, { ...CONFIG, table: 'incident' });
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'ServiceNowAdapter',
        config: { instance_url: 'https://x.service-now.com', username: 'u', password: 'p' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(ServiceNowAdapter);
    });
  });
});
