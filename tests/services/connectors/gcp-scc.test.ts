import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { generateKeyPairSync, createVerify } from 'crypto';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  GcpSccAdapter,
  mapSeverity,
  classifyThreatType,
  extractCveId,
  resolveParent,
  buildFilter,
} from '../../../src/services/connectors/adapters/gcp-scc.js';
import { buildAssertion } from '../../../src/services/connectors/utils/gcp-auth.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function tokenResponse(token = 'gcp-tok-1', expiresIn = 3600): Response {
  return jsonResponse({ access_token: token, expires_in: expiresIn, token_type: 'Bearer' });
}

function decodeB64Url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf-8');
}

let TEST_PRIVATE_KEY: string;
let TEST_PUBLIC_KEY: string;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  TEST_PRIVATE_KEY = privateKey;
  TEST_PUBLIC_KEY = publicKey;
});

function makeConfig(extras: Record<string, any> = {}): any {
  return {
    project_id: 'acme-prod',
    service_account_key: {
      client_email: 'attesting@acme-prod.iam.gserviceaccount.com',
      private_key: TEST_PRIVATE_KEY,
      token_uri: 'https://oauth2.googleapis.com/token',
    },
    ...extras,
  };
}

function makeFinding(overrides: Record<string, any> = {}): any {
  return {
    name: 'organizations/1/sources/2/findings/abc',
    parent: 'organizations/1/sources/2',
    resourceName: '//compute.googleapis.com/projects/acme/zones/us-central1/instances/vm-1',
    state: 'ACTIVE',
    category: 'MALWARE_HIT',
    severity: 'HIGH',
    eventTime: '2026-04-05T10:00:00.000Z',
    createTime: '2026-04-05T09:59:00.000Z',
    description: 'Suspicious binary executed on VM',
    externalUri: 'https://console.cloud.google.com/security/...',
    sourceProperties: { Explanation: 'Binary matched known malware hash' },
    ...overrides,
  };
}

describe('GcpSccAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'GcpSccAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('JWT assertion', () => {
    it('builds a well-formed RS256 JWT with the expected claims', () => {
      const now = new Date('2026-04-05T10:00:00Z');
      const jwt = buildAssertion(
        {
          client_email: 'sa@acme.iam.gserviceaccount.com',
          private_key: TEST_PRIVATE_KEY,
          token_uri: 'https://oauth2.googleapis.com/token',
        },
        'https://www.googleapis.com/auth/cloud-platform',
        now,
      );

      const [hB64, cB64, sigB64] = jwt.split('.');
      const header = JSON.parse(decodeB64Url(hB64));
      const claims = JSON.parse(decodeB64Url(cB64));

      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');
      expect(claims.iss).toBe('sa@acme.iam.gserviceaccount.com');
      expect(claims.sub).toBe('sa@acme.iam.gserviceaccount.com');
      expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
      expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
      expect(claims.iat).toBe(Math.floor(now.getTime() / 1000));
      expect(claims.exp).toBe(claims.iat + 3600);

      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${hB64}.${cB64}`);
      verifier.end();
      const valid = verifier.verify(TEST_PUBLIC_KEY, Buffer.from(sigB64, 'base64url'));
      expect(valid).toBe(true);
    });
  });

  describe('pure helpers', () => {
    it('mapSeverity handles SCC severity enum', () => {
      expect(mapSeverity('CRITICAL')).toBe('critical');
      expect(mapSeverity('HIGH')).toBe('high');
      expect(mapSeverity('MEDIUM')).toBe('medium');
      expect(mapSeverity('LOW')).toBe('low');
      expect(mapSeverity('SEVERITY_UNSPECIFIED')).toBe('info');
      expect(mapSeverity(undefined)).toBe('medium');
    });

    it('mapSeverity only emits CHECK-compliant values', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      for (const v of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'SEVERITY_UNSPECIFIED', 'weird', null]) {
        expect(allowed.has(mapSeverity(v))).toBe(true);
      }
    });

    it('classifyThreatType maps SCC categories to CHECK values', () => {
      expect(classifyThreatType('MALWARE_HIT')).toBe('malware');
      expect(classifyThreatType('OS_VULNERABILITY')).toBe('vulnerability');
      expect(classifyThreatType('IAM_MISCONFIGURATION')).toBe('vulnerability');
      expect(classifyThreatType('PERSISTENCE_ADDED')).toBe('ttp');
      expect(classifyThreatType('LATERAL_MOVEMENT')).toBe('ttp');
      expect(classifyThreatType('EXFILTRATION_DETECTED')).toBe('ttp');
      expect(classifyThreatType('BRUTE_FORCE_SSH')).toBe('exploit');
      expect(classifyThreatType('PRIVILEGE_ESCALATION')).toBe('exploit');
      expect(classifyThreatType('BOTNET_ACTIVITY')).toBe('campaign');
      expect(classifyThreatType('C2_COMMUNICATION')).toBe('campaign');
      expect(classifyThreatType('UNKNOWN')).toBe('advisory');
    });

    it('resolveParent prefers organization over project', () => {
      expect(resolveParent({ organization_id: '1', project_id: 'p' })).toBe('organizations/1');
      expect(resolveParent({ project_id: 'p' })).toBe('projects/p');
      expect(resolveParent({})).toBeNull();
    });

    it('buildFilter combines base + eventTime', () => {
      const f = buildFilter('state="ACTIVE"', '2026-04-01T00:00:00.000Z');
      expect(f).toContain('(state="ACTIVE")');
      expect(f).toContain('eventTime >= "2026-04-01T00:00:00.000Z"');
    });

    it('extractCveId finds CVEs across finding fields', () => {
      expect(extractCveId({ description: 'CVE-2024-1234 present' })).toBe('CVE-2024-1234');
      expect(extractCveId({ sourceProperties: { detail: 'cve-2023-9999' } })).toBe('CVE-2023-9999');
      expect(extractCveId({})).toBeNull();
    });
  });

  describe('transform', () => {
    it('maps a finding to a threat_inputs entity', () => {
      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      const result = adapter.transform(makeFinding())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('organizations/1/sources/2/findings/abc');
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('malware');
      expect(result.severity).toBe('high');
      expect(result.source_name).toBe('Google Cloud SCC');
      expect(result.title).toContain('MALWARE_HIT');
      expect(result.description).toContain('Suspicious binary');
      expect(JSON.parse(result.affected_platforms)).toContain('gcp/compute');
      expect(JSON.parse(result.affected_products)[0]).toContain('compute.googleapis.com');

      const iocs = JSON.parse(result.iocs);
      expect(iocs.category).toBe('MALWARE_HIT');
      expect(iocs.state).toBe('ACTIVE');
      expect(iocs.resourceName).toContain('instances/vm-1');
      expect(iocs.eventTime).toBe('2026-04-05T10:00:00.000Z');
    });

    it('transform output satisfies CHECK constraints across severities and categories', () => {
      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      const fixtures: Array<[string, string]> = [
        ['CRITICAL', 'MALWARE_HIT'],
        ['HIGH', 'OS_VULNERABILITY'],
        ['MEDIUM', 'PERSISTENCE_ADDED'],
        ['LOW', 'BRUTE_FORCE_SSH'],
        ['SEVERITY_UNSPECIFIED', 'UNKNOWN'],
      ];
      for (const [severity, category] of fixtures) {
        const result = adapter.transform(makeFinding({ severity, category }))!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when finding has no name', () => {
      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      expect(adapter.transform({ category: 'x' })).toBeNull();
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when service_account_key missing', () => {
      expect(() => new GcpSccAdapter(db, connectorId, { project_id: 'p' }))
        .toThrow(/service_account_key/);
    });

    it('throws on construction when neither project_id nor organization_id present', () => {
      const cfg = makeConfig();
      delete cfg.project_id;
      expect(() => new GcpSccAdapter(db, connectorId, cfg))
        .toThrow(/project_id or organization_id/);
    });

    it('fetches token then GETs project findings with default filter', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          jsonResponse({ listFindingsResults: [{ finding: makeFinding() }] }),
        );

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      const results = await adapter.fetch(null);
      expect(results).toHaveLength(1);

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
      expect(String(tokenUrl)).toBe('https://oauth2.googleapis.com/token');
      expect(String(tokenInit.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
      expect(String(tokenInit.body)).toContain('assertion=');

      const [apiUrl, apiInit] = fetchMock.mock.calls[1];
      expect(String(apiUrl)).toContain('/v1/projects/acme-prod/sources/-/findings');
      expect(apiInit.headers.Authorization).toBe('Bearer gcp-tok-1');

      const decoded = decodeURIComponent(String(apiUrl)).replace(/\+/g, ' ');
      expect(decoded).toContain('state="ACTIVE" AND severity!="LOW"');
      expect(decoded).toContain('pageSize=200');
    });

    it('uses organizations endpoint when organization_id provided', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ listFindingsResults: [] }));

      const cfg = makeConfig({ organization_id: '999', project_id: undefined });
      const adapter = new GcpSccAdapter(db, connectorId, cfg);
      await adapter.fetch(null);

      expect(String(fetchMock.mock.calls[1][0])).toContain('/v1/organizations/999/sources/-/findings');
    });

    it('applies custom filter and eventTime for incremental sync', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(jsonResponse({ listFindingsResults: [] }));

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig({ filter: 'state="ACTIVE"' }));
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const url = decodeURIComponent(String(fetchMock.mock.calls[1][0])).replace(/\+/g, ' ');
      expect(url).toContain('(state="ACTIVE")');
      expect(url).toContain('eventTime >= "2026-04-01T00:00:00.000Z"');
    });

    it('follows nextPageToken to paginate', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          jsonResponse({
            listFindingsResults: [{ finding: makeFinding({ name: 'f1' }) }],
            nextPageToken: 'tok-page-2',
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            listFindingsResults: [{ finding: makeFinding({ name: 'f2' }) }],
          }),
        );

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(2);
      const url2 = decodeURIComponent(String(fetchMock.mock.calls[2][0]));
      expect(url2).toContain('pageToken=tok-page-2');
    });

    it('refreshes token and retries on 401', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse('tok-1'))
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(tokenResponse('tok-2'))
        .mockResolvedValueOnce(jsonResponse({ listFindingsResults: [] }));

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      await adapter.fetch(null);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer tok-2');
    });

    it('surfaces persistent 403 as auth failure', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ listFindingsResults: [] }));

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(1500);
      await promise;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('surfaces 5xx errors', async () => {
      fetchMock
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));

      const adapter = new GcpSccAdapter(db, connectorId, makeConfig());
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'GcpSccAdapter',
        config: makeConfig(),
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(GcpSccAdapter);
    });
  });
});
