import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchAccessToken, type ServiceAccountKey } from '../utils/gcp-auth.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const SCC_BASE = 'https://securitycenter.googleapis.com/v1';
const DEFAULT_FILTER = 'state="ACTIVE" AND severity!="LOW"';
const DEFAULT_PAGE_SIZE = 200;

/**
 * Inbound adapter for Google Cloud Security Command Center findings.
 *
 * Auth: OAuth2 via self-signed JWT using a service-account key (RS256).
 * Endpoint: GET /v1/{parent}/sources/-/findings where parent is
 *           `organizations/{id}` or `projects/{id}`.
 * Pagination: `pageToken` cursor.
 * Incremental: filter on `eventTime >= "{since}"`.
 *
 * Config: { project_id?, organization_id?, service_account_key, filter?, page_size? }
 */
export class GcpSccAdapter extends BaseAdapter {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
    if (!this.config.service_account_key || !this.config.service_account_key.client_email) {
      throw new Error('GCP SCC: service_account_key with client_email and private_key is required');
    }
    if (!resolveParent(this.config)) {
      throw new Error('GCP SCC: project_id or organization_id is required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    const parent = resolveParent(this.config)!;

    await this.ensureToken();

    const filter = buildFilter(this.config.filter ?? DEFAULT_FILTER, since);
    const pageSize = Number(this.config.page_size ?? DEFAULT_PAGE_SIZE);
    const baseUrl = `${SCC_BASE}/${parent}/sources/-/findings`;

    const results: any[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = Number(this.config.max_pages ?? 100);

    while (pageCount < maxPages) {
      const params = new URLSearchParams({ pageSize: String(pageSize) });
      if (filter) params.set('filter', filter);
      if (pageToken) params.set('pageToken', pageToken);

      const data = await this.authedRequest(`${baseUrl}?${params.toString()}`);
      const listResults: any[] = data?.listFindingsResults ?? [];
      for (const entry of listResults) {
        if (entry.finding) results.push(entry.finding);
      }
      pageToken = data?.nextPageToken;
      pageCount++;
      if (!pageToken) break;
    }

    return results;
  }

  transform(finding: any): { _table: string; external_id: string; [k: string]: any } | null {
    const externalId = finding.name ?? finding.canonicalName;
    if (!externalId) return null;

    const category = finding.category ?? 'UNKNOWN';
    const severity = mapSeverity(finding.severity);
    const state = finding.state ?? 'ACTIVE';
    const resourceName = finding.resourceName ?? null;
    const parent = finding.parent ?? null;
    const externalUri = finding.externalUri ?? null;
    const sourceProps = finding.sourceProperties ?? {};

    const title = `GCP SCC: ${category}`.substring(0, 240);
    const description = String(
      finding.description
        ?? sourceProps.Explanation
        ?? `${category} on ${resourceName ?? 'resource'}`,
    ).substring(0, 4000);

    const platforms: string[] = [];
    if (resourceName) {
      const type = inferResourceType(resourceName);
      if (type) platforms.push(`gcp/${type}`);
    }

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: classifyThreatType(category),
      title,
      description,
      severity,
      cvss_score: null,
      cve_id: extractCveId(finding),
      source_ref: externalUri ?? `https://console.cloud.google.com/security/command-center/findings`,
      source_name: 'Google Cloud SCC',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(resourceName ? [resourceName] : []),
      ttps: JSON.stringify([category]),
      iocs: JSON.stringify({
        raw: finding,
        category,
        state,
        parent,
        resourceName,
        eventTime: finding.eventTime,
        createTime: finding.createTime,
        sourceProperties: sourceProps,
      }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(externalId),
      external_source: this.connectorId,
    };
  }

  // ── Auth ──────────────────────────────────────────────

  private async ensureToken(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiresAt - 30_000) return;
    const key = this.config.service_account_key as ServiceAccountKey;
    const tr = await fetchAccessToken(key, undefined, undefined, this.timeoutMs());
    this.token = tr.access_token;
    this.tokenExpiresAt = Date.now() + (tr.expires_in ?? 3600) * 1000;
  }

  private async authedRequest(url: string, retried = false): Promise<any> {
    await this.ensureToken();
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
      timeoutMs: this.timeoutMs(),
      adapter: 'GCP SCC',
    });

    if (res.status === 401 && !retried) {
      this.token = null;
      this.tokenExpiresAt = 0;
      return this.authedRequest(url, true);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 5);
      await sleep(Math.min(retryAfter, 60) * 1000);
      return this.authedRequest(url, retried);
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`GCP SCC auth failed: ${res.status} (check service account permissions)`);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`GCP SCC API ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// ── Helpers (exported for tests) ───────────────────────────

/** Map SCC severity enum → threat_inputs severity CHECK set. */
export function mapSeverity(value: unknown): string {
  const s = String(value ?? '').toUpperCase();
  if (s === 'CRITICAL') return 'critical';
  if (s === 'HIGH') return 'high';
  if (s === 'MEDIUM') return 'medium';
  if (s === 'LOW') return 'low';
  if (s === 'SEVERITY_UNSPECIFIED' || s === 'UNSPECIFIED') return 'info';
  return 'medium';
}

/** Classify SCC finding category into a CHECK-compliant threat_type. */
export function classifyThreatType(category: unknown): string {
  const c = String(category ?? '').toUpperCase();
  if (c.includes('MALWARE')) return 'malware';
  if (c.includes('VULNERABILITY') || c.includes('MISCONFIGURATION') || c.includes('WEAK')) return 'vulnerability';
  if (c.includes('PERSISTENCE') || c.includes('LATERAL') || c.includes('EXFILTRATION') || c.includes('DISCOVERY') || c.includes('EVASION')) return 'ttp';
  if (c.includes('BRUTE_FORCE') || c.includes('EXPLOIT') || c.includes('INJECTION') || c.includes('PRIVILEGE_ESCALATION')) return 'exploit';
  if (c.includes('BOTNET') || c.includes('C2') || c.includes('COMMAND_AND_CONTROL')) return 'campaign';
  return 'advisory';
}

export function extractCveId(finding: any): string | null {
  const re = /CVE-\d{4}-\d{4,7}/i;
  const candidates = [
    finding.description,
    finding.category,
    ...(finding.sourceProperties ? Object.values(finding.sourceProperties) : []),
  ];
  for (const c of candidates) {
    const m = typeof c === 'string' ? c.match(re) : null;
    if (m) return m[0].toUpperCase();
  }
  return null;
}

export function resolveParent(config: any): string | null {
  if (config.organization_id) return `organizations/${config.organization_id}`;
  if (config.project_id) return `projects/${config.project_id}`;
  return null;
}

export function buildFilter(base: string, since: string | null): string {
  const parts: string[] = [];
  if (base && base.trim()) parts.push(`(${base.trim()})`);
  if (since) {
    parts.push(`eventTime >= "${new Date(since).toISOString()}"`);
  }
  return parts.join(' AND ');
}

function inferResourceType(resourceName: string): string | null {
  const m = /\/\/([a-z]+)\.googleapis\.com\//.exec(resourceName);
  if (m) return m[1];
  const parts = resourceName.split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
