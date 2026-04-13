import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../../helpers/test-db.js';
import {
  JiraAdapter,
  mapSeverity,
  classifyThreatType,
  extractCveId,
  adfToText,
  buildJql,
} from '../../../src/services/connectors/adapters/jira.js';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const CONFIG = {
  base_url: 'https://acme.atlassian.net',
  email: 'alice@acme.com',
  api_token: 'token-xyz',
};

function makeIssue(overrides: Record<string, any> = {}): any {
  return {
    id: '10001',
    key: 'SEC-42',
    fields: {
      summary: 'Log4j RCE on auth service',
      description: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Impacts CVE-2021-44228 path.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Patch ASAP.' }] },
        ],
      },
      priority: { name: 'High' },
      status: { name: 'In Progress' },
      labels: ['security', 'vulnerability', 'cve'],
      components: [{ name: 'auth-service' }, { name: 'api-gateway' }],
      assignee: { displayName: 'Bob' },
      project: { key: 'SEC' },
      issuetype: { name: 'Bug' },
      updated: '2026-04-05T10:00:00.000+0000',
      ...overrides.fields,
    },
    ...overrides,
  };
}

describe('JiraAdapter', () => {
  let db: Database.Database;
  let connectorId: string;
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    db = createTestDb();
    connectorId = seedConnector(db, { adapterClass: 'JiraAdapter' });
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe('pure helpers', () => {
    it('mapSeverity maps Jira priorities', () => {
      expect(mapSeverity('Highest')).toBe('critical');
      expect(mapSeverity('High')).toBe('high');
      expect(mapSeverity('Medium')).toBe('medium');
      expect(mapSeverity('Low')).toBe('low');
      expect(mapSeverity('Lowest')).toBe('info');
      expect(mapSeverity('Blocker')).toBe('critical');
      expect(mapSeverity('Trivial')).toBe('info');
      expect(mapSeverity(undefined)).toBe('medium');
    });

    it('mapSeverity only emits CHECK-compliant values', () => {
      const allowed = new Set(['info', 'low', 'medium', 'high', 'critical']);
      for (const p of ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'unknown', null]) {
        expect(allowed.has(mapSeverity(p))).toBe(true);
      }
    });

    it('classifyThreatType picks vulnerability for CVE labels', () => {
      expect(classifyThreatType(['security', 'cve'])).toBe('vulnerability');
      expect(classifyThreatType(['exploit'])).toBe('exploit');
      expect(classifyThreatType(['ransomware'])).toBe('malware');
      expect(classifyThreatType(['mitre'])).toBe('ttp');
      expect(classifyThreatType(['general'])).toBe('advisory');
    });

    it('extractCveId finds CVEs in summary/description/labels', () => {
      expect(extractCveId('Patch CVE-2024-1234', '', [])).toBe('CVE-2024-1234');
      expect(extractCveId('', 'related to cve-2023-0001', [])).toBe('CVE-2023-0001');
      expect(extractCveId('', '', ['cve-2022-9999'])).toBe('CVE-2022-9999');
      expect(extractCveId('no cve here', '', [])).toBeNull();
    });

    it('adfToText walks ADF docs', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Line 2' }] },
        ],
      };
      const text = adfToText(doc);
      expect(text).toContain('Hello world');
      expect(text).toContain('Line 2');
    });

    it('adfToText handles plain strings and null', () => {
      expect(adfToText('plain')).toBe('plain');
      expect(adfToText(null)).toBe('');
      expect(adfToText(undefined)).toBe('');
    });

    it('buildJql combines base + updated filter', () => {
      const jql = buildJql('project = SEC', '2026-04-01T00:00:00.000Z');
      expect(jql).toContain('(project = SEC)');
      expect(jql).toContain('updated >= "2026-04-01 00:00"');
      expect(jql).toContain('ORDER BY updated ASC');
    });

    it('buildJql omits updated when since is null', () => {
      const jql = buildJql('project = SEC', null);
      expect(jql).not.toContain('updated >=');
      expect(jql).toContain('(project = SEC)');
    });
  });

  describe('transform', () => {
    it('maps a security issue to a threat_inputs entity', () => {
      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      const result = adapter.transform(makeIssue())!;

      expect(result._table).toBe('threat_inputs');
      expect(result.external_id).toBe('SEC-42');
      expect(result.external_source).toBe(connectorId);
      expect(result.channel).toBe('internal');
      expect(result.threat_type).toBe('vulnerability');
      expect(result.severity).toBe('high');
      expect(result.source_name).toBe('Jira');
      expect(result.source_ref).toBe('https://acme.atlassian.net/browse/SEC-42');
      expect(result.title).toContain('SEC-42');
      expect(result.title).toContain('Log4j');
      expect(result.description).toContain('CVE-2021-44228');
      expect(result.cve_id).toBe('CVE-2021-44228');
      expect(JSON.parse(result.affected_platforms)).toEqual(['auth-service', 'api-gateway']);
      expect(JSON.parse(result.affected_products)).toEqual(['SEC']);

      const iocs = JSON.parse(result.iocs);
      expect(iocs.status).toBe('In Progress');
      expect(iocs.priority).toBe('High');
      expect(iocs.assignee).toBe('Bob');
      expect(iocs.labels).toEqual(['security', 'vulnerability', 'cve']);
    });

    it('transform output satisfies all threat_inputs CHECK constraints across priorities', () => {
      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      const allowedChannels = ['stix_taxii','cisa_kev','nvd','isac','vendor_advisory','manual','osint','internal'];
      const allowedThreatTypes = ['vulnerability','exploit','campaign','malware','ttp','advisory','regulatory','best_practice'];
      const allowedSeverities = ['info','low','medium','high','critical'];

      for (const p of ['Highest', 'High', 'Medium', 'Low', 'Lowest']) {
        const issue = makeIssue();
        issue.fields.priority = { name: p };
        const result = adapter.transform(issue)!;
        expect(allowedChannels).toContain(result.channel);
        expect(allowedThreatTypes).toContain(result.threat_type);
        expect(allowedSeverities).toContain(result.severity);
      }
    });

    it('returns null when issue has no key or id', () => {
      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      expect(adapter.transform({ fields: { summary: 'x' } })).toBeNull();
    });

    it('handles plain-text descriptions', () => {
      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      const issue = makeIssue();
      issue.fields.description = 'Just a plain string';
      const result = adapter.transform(issue)!;
      expect(result.description).toBe('Just a plain string');
    });
  });

  describe('fetch flow', () => {
    it('throws on construction when required config missing', () => {
      expect(() => new JiraAdapter(db, connectorId, { base_url: 'x' })).toThrow(/base_url|email|api_token/);
    });

    it('POSTs /rest/api/3/search with default JQL and basic auth', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [makeIssue()], total: 1 }));

      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://acme.atlassian.net/rest/api/3/search');
      expect(init.method).toBe('POST');

      const auth = init.headers.Authorization as string;
      expect(auth).toMatch(/^Basic /);
      const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
      expect(decoded).toBe('alice@acme.com:token-xyz');

      const body = JSON.parse(init.body as string);
      expect(body.jql).toContain('issuetype in (Bug, Task)');
      expect(body.jql).toContain('labels in (security, vulnerability, cve)');
      expect(body.startAt).toBe(0);
      expect(body.maxResults).toBe(50);
      expect(body.fields).toContain('summary');
      expect(body.fields).toContain('priority');
    });

    it('supports custom JQL from config', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], total: 0 }));

      const adapter = new JiraAdapter(db, connectorId, {
        ...CONFIG,
        jql: 'project = FOO AND status = Open',
      });
      await adapter.fetch(null);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.jql).toContain('(project = FOO AND status = Open)');
    });

    it('adds updated >= filter on incremental sync', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ issues: [], total: 0 }));

      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      await adapter.fetch('2026-04-01T00:00:00.000Z');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.jql).toContain('updated >= "2026-04-01 00:00"');
      expect(body.jql).toContain('ORDER BY updated ASC');
    });

    it('paginates via startAt until issues < maxResults', async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => makeIssue({ key: `SEC-${i}` }));
      const page2 = [makeIssue({ key: 'SEC-50' })];

      fetchMock
        .mockResolvedValueOnce(jsonResponse({ issues: page1, total: 51 }))
        .mockResolvedValueOnce(jsonResponse({ issues: page2, total: 51 }));

      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      const results = await adapter.fetch(null);

      expect(results).toHaveLength(51);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).startAt).toBe(0);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).startAt).toBe(50);
    });

    it('honors 429 Retry-After and retries', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
        )
        .mockResolvedValueOnce(jsonResponse({ issues: [], total: 0 }));

      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      const promise = adapter.fetch(null);
      await vi.advanceTimersByTimeAsync(1500);
      const results = await promise;

      expect(results).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces 401 auth errors clearly', async () => {
      fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/auth failed/i);
    });

    it('surfaces 5xx errors', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const adapter = new JiraAdapter(db, connectorId, CONFIG);
      await expect(adapter.fetch(null)).rejects.toThrow(/500/);
    });
  });

  describe('registry integration', () => {
    it('is instantiable via AdapterRegistry', async () => {
      const connId = seedConnector(db, {
        adapterClass: 'JiraAdapter',
        config: { base_url: 'https://acme.atlassian.net', email: 'u@acme.com', api_token: 't' },
      });
      const { AdapterRegistry } = await import('../../../src/services/connectors/registry.js');
      const registry = new AdapterRegistry();
      const connector = db.prepare('SELECT * FROM connectors WHERE id = ?').get(connId) as any;
      const adapter = registry.create(db, connector);
      expect(adapter).toBeInstanceOf(JiraAdapter);
    });
  });
});
