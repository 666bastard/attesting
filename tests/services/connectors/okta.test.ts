import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  OktaAdapter,
  classifySeverity,
  classifyThreatType,
  parseLinkNext,
} from '../../../src/services/connectors/adapters/okta.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const CONFIG = {
  domain: 'acme.okta.com',
  api_token: 'ssws-token-abc',
};

function makeEvent(overrides: Record<string, any> = {}): any {
  return {
    uuid: 'evt-1',
    eventType: 'user.session.start',
    displayMessage: 'User login',
    outcome: { result: 'FAILURE', reason: 'INVALID_CREDENTIALS' },
    actor: { id: 'u1', displayName: 'Alice', alternateId: 'alice@acme.com', type: 'User' },
    client: {
      ipAddress: '203.0.113.7',
      userAgent: { os: 'macOS' },
      geographicalContext: { country: 'US', city: 'Seattle' },
    },
    target: [
      { id: 'app1', type: 'AppInstance', displayName: 'Gmail', alternateId: 'gmail' },
    ],
    published: '2026-04-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('OktaAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'OktaAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('pure helpers', () => {
    it('classifySeverity handles known event families', () => {
      expect(classifySeverity('security.threat.detected', 'ALLOW')).toBe('critical');
      expect(classifySeverity('user.suspicious.activity', null)).toBe('critical');
      expect(classifySeverity('user.account.lock', 'SUCCESS')).toBe('high');
      expect(classifySeverity('user.mfa.factor.deactivate', 'SUCCESS')).toBe('high');
      expect(classifySeverity('policy.evaluate_sign_on', 'DENY')).toBe('high');
      expect(classifySeverity('user.session.start', 'FAILURE')).toBe('medium');
      expect(classifySeverity('user.authentication.auth', 'FAILURE')).toBe('medium');
      expect(classifySeverity('something.else', 'FAILURE')).toBe('medium');
      expect(classifySeverity('security.api.token.create', 'SUCCESS')).toBe('high');
      expect(classifySeverity('user.session.start', 'SUCCESS')).toBe('info');
      expect(classifySeverity('noise', null)).toBe('low');
    });

    it('classifySeverity only emits CHECK-compliant values', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      const fixtures: Array<[string, string | null]> = [
        ['security.threat.detected', 'DENY'],
        ['user.account.lock', 'SUCCESS'],
        ['user.session.start', 'FAILURE'],
        ['user.session.start', 'SUCCESS'],
        ['policy.evaluate_sign_on', 'DENY'],
        ['noise', null],
      ];
      for (const [t, o] of fixtures) {
        expect(allowed.has(classifySeverity(t, o))).toBe(true);
      }
    });

    it('classifyThreatType maps event types to CHECK values', () => {
      expect(classifyThreatType('user.suspicious.login')).toBe('campaign');
      expect(classifyThreatType('policy.evaluate_sign_on')).toBe('ttp');
      expect(classifyThreatType('user.session.start')).toBe('ttp');
      expect(classifyThreatType('user.account.lock')).toBe('advisory');
    });

    it('parseLinkNext extracts the rel="next" URL', () => {
      const header = '<https://acme.okta.com/api/v1/logs?after=page2>; rel="next", <https://acme.okta.com/api/v1/logs?after=page0>; rel="self"';
      expect(parseLinkNext(header)).toBe('https://acme.okta.com/api/v1/logs?after=page2');
    });

    it('parseLinkNext returns null when no next link exists', () => {
      expect(parseLinkNext(null)).toBeNull();
      expect(parseLinkNext('<https://x/api>; rel="self"')).toBeNull();
    });
  });

  describe('transform', () => {
    it('maps a failed login event to a threat_inputs entity', () => {
      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      const result = adapter.transform(makeEvent())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('evt-1');
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('ttp');
      expect(result.severity).toBe('medium');
      expect(result.source_name).toBe('Okta System Log');
      expect(result.title).toContain('User login');
      expect(result.description).toContain('alice@acme.com');
      expect(result.description).toContain('203.0.113.7');
      expect(result.description).toContain('FAILURE');
      expect(JSON.parse(result.affected_platforms)).toContain('geo:US');
      expect(JSON.parse(result.affected_platforms)).toContain('macOS');
      expect(JSON.parse(result.affected_products)).toContain('Gmail');

      const iocs = JSON.parse(result.iocs);
      expect(iocs.actor.name).toBe('Alice');
      expect(iocs.client.ip).toBe('203.0.113.7');
      expect(iocs.client.country).toBe('US');
      expect(iocs.outcome).toBe('FAILURE');
      expect(iocs.targets).toHaveLength(1);
    });

    it('transform output satisfies all threat_inputs CHECK constraints across event types', () => {
      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      const fixtures: Array<[string, string]> = [
        ['security.threat.detected', 'DENY'],
        ['user.suspicious.activity', 'SUCCESS'],
        ['user.account.lock', 'SUCCESS'],
        ['user.mfa.factor.deactivate', 'SUCCESS'],
        ['policy.evaluate_sign_on', 'DENY'],
        ['user.session.start', 'FAILURE'],
        ['user.session.start', 'SUCCESS'],
      ];
      for (const [eventType, outcome] of fixtures) {
        const result = adapter.transform(makeEvent({ eventType, outcome: { result: outcome } }))!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when event has no uuid', () => {
      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      expect(adapter.transform({ eventType: 'x' })).toBeNull();
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when required config missing', () => {
      expect(() => new OktaAdapter(db, connectorId, { domain: 'acme.okta.com' })).toThrow(/api_token/);
    });

    it('calls /api/v1/logs with SSWS auth, default filter, and since', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([makeEvent()]));

      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);
      expect(results).toHaveLength(1);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('https://acme.okta.com/api/v1/logs?');
      expect(init.headers.Authorization).toBe('SSWS ssws-token-abc');

      const decoded = decodeURIComponent(String(url)).replace(/\+/g, ' ');
      expect(decoded).toContain('filter=(eventType sw "security.")');
      expect(decoded).toContain('since=');
      expect(decoded).toContain('sortOrder=ASCENDING');
    });

    it('passes since from incremental sync', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));

      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
      expect(url).toContain('since=2026-04-01T00:00:00.000Z');
    });

    it('supports custom filter override', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([]));

      const adapter = new OktaAdapter(db, connectorId, {
        ...CONFIG,
        filter: 'eventType eq "user.account.lock"',
      });
      await adapter.fetch(null);

      const url = decodeURIComponent(String(fetchMock.mock.calls[0][0])).replace(/\+/g, ' ');
      expect(url).toContain('filter=eventType eq "user.account.lock"');
    });

    it('follows Link rel="next" to paginate', async () => {
      const nextUrl = 'https://acme.okta.com/api/v1/logs?after=cursor-2';
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse([makeEvent({ uuid: 'evt-1' })], 200, {
            Link: `<${nextUrl}>; rel="next"`,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([makeEvent({ uuid: 'evt-2' })], 200, {
            Link: '<https://acme.okta.com/api/v1/logs?after=self>; rel="self"',
          }),
        );

      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(2);
      expect(String(fetchMock.mock.calls[1][0])).toBe(nextUrl);
    });

    it('stops when page returns empty array even with Link header', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse([], 200, { Link: '<https://acme.okta.com/api/v1/logs?after=next>; rel="next"' }),
      );

      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);
      expect(results).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('honors 429 with X-Rate-Limit-Reset and retries', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-05T10:00:00.000Z'));
      const resetSec = Math.floor(Date.now() / 1000) + 1;

      fetchMock
        .mockResolvedValueOnce(
          new Response('rate limited', {
            status: 429,
            headers: { 'X-Rate-Limit-Reset': String(resetSec) },
          }),
        )
        .mockResolvedValueOnce(jsonResponse([]));

      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces 401 auth errors clearly', async () => {
      fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });

    it('surfaces 5xx errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const adapter = new OktaAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'OktaAdapter',
        config: { domain: 'acme.okta.com', api_token: 't' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(OktaAdapter);
    });
  });
});
