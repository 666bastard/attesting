import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DEFAULT_BASE_URL = 'https://api.crowdstrike.com';
const PAGE_SIZE = 500;
const MAX_SUMMARIES_PER_CALL = 1000;

/**
 * Inbound adapter for CrowdStrike Falcon detections.
 *
 * Auth: OAuth2 client_credentials → bearer token (cached; refreshed on 401).
 * Fetch: GET /detections/queries/detections/v1 → IDs, then
 *        POST /detections/entities/summaries/GET/v2 → full summaries.
 * Transform: detection → threat_inputs (CVE from behaviors[].technique).
 *
 * Config: { client_id, client_secret, base_url? }
 */
export class CrowdStrikeAdapter extends BaseAdapter {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, { base_url: DEFAULT_BASE_URL, ...config });
    if (!this.config.client_id || !this.config.client_secret) {
      throw new Error('CrowdStrike: client_id and client_secret are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    await this.ensureToken();

    const ids: string[] = [];
    let offset = 0;
    let total = Infinity;

    const filterParts: string[] = [];
    if (since) {
      filterParts.push(`last_behavior:>='${new Date(since).toISOString()}'`);
    }
    const filter = filterParts.join('+');

    while (offset < total) {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: 'last_behavior.desc',
      });
      if (filter) params.set('filter', filter);

      const url = `${this.config.base_url}/detects/queries/detects/v1?${params.toString()}`;
      const data = await this.authedRequest(url, { method: 'GET' });

      const resources: string[] = data.resources ?? [];
      ids.push(...resources);

      total = data.meta?.pagination?.total ?? resources.length;
      offset += PAGE_SIZE;

      if (resources.length < PAGE_SIZE) break;
    }

    if (ids.length === 0) return [];

    const summaries: any[] = [];
    for (let i = 0; i < ids.length; i += MAX_SUMMARIES_PER_CALL) {
      const batch = ids.slice(i, i + MAX_SUMMARIES_PER_CALL);
      const url = `${this.config.base_url}/detects/entities/summaries/GET/v1`;
      const data = await this.authedRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: batch }),
      });
      summaries.push(...(data.resources ?? []));
    }

    return summaries;
  }

  transform(detection: any): { _table: string; external_id: string; [k: string]: any } | null {
    const detectionId = detection.detection_id ?? detection.id;
    if (!detectionId) return null;

    const severity = mapSeverity(
      detection.max_severity_displayname ?? detection.severity_name ?? detection.max_severity,
    );
    const cveId = extractCveId(detection);
    const platforms = extractPlatforms(detection);
    const products = extractProducts(detection);
    const title = buildTitle(detection);
    const description = detection.description
      ?? detection.behaviors?.[0]?.description
      ?? detection.behaviors?.[0]?.scenario
      ?? '';

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'vendor_advisory',
      threat_type: 'ttp',
      title,
      description,
      severity,
      cvss_score: null,
      cve_id: cveId,
      source_ref: `${this.config.base_url}/detects/entities/summaries/GET/v1?id=${encodeURIComponent(detectionId)}`,
      source_name: 'CrowdStrike Falcon',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(products),
      ttps: JSON.stringify(extractTtps(detection)),
      iocs: JSON.stringify({ raw: detection }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(detectionId),
      external_source: this.connectorId,
    };
  }

  // ── Auth ──────────────────────────────────────────────

  private async ensureToken(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiresAt - 30_000) return;

    const body = new URLSearchParams({
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
    });

    const res = await fetchWithTimeout(`${this.config.base_url}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      timeoutMs: this.timeoutMs(),
      adapter: 'CrowdStrike',
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`CrowdStrike auth failed: ${res.status} ${text}`);
    }

    const data: any = await res.json();
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 1800) * 1000;
  }

  private async authedRequest(url: string, init: RequestInit, retried = false): Promise<any> {
    await this.ensureToken();
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string>) ?? {}),
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };

    const res = await fetchWithTimeout(url, {
      ...init,
      headers,
      timeoutMs: this.timeoutMs(),
      adapter: 'CrowdStrike',
    });

    if (res.status === 401 && !retried) {
      this.token = null;
      this.tokenExpiresAt = 0;
      return this.authedRequest(url, init, true);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('X-Ratelimit-RetryAfter') ?? res.headers.get('Retry-After') ?? 5);
      await new Promise(r => setTimeout(r, Math.min(retryAfter, 60) * 1000));
      return this.authedRequest(url, init, retried);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`CrowdStrike API ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// ── Transform helpers (exported for tests) ─────────────────

export function mapSeverity(value: unknown): string {
  if (typeof value === 'number') {
    if (value >= 90) return 'critical';
    if (value >= 70) return 'high';
    if (value >= 40) return 'medium';
    if (value >= 20) return 'low';
    return 'info';
  }
  const s = String(value ?? '').toLowerCase();
  if (s.includes('critical')) return 'critical';
  if (s.includes('high')) return 'high';
  if (s.includes('medium')) return 'medium';
  if (s.includes('low')) return 'low';
  return 'medium';
}

export function extractCveId(detection: any): string | null {
  const behaviors: any[] = detection.behaviors ?? [];
  const re = /CVE-\d{4}-\d{4,7}/i;
  for (const b of behaviors) {
    const candidates = [b.technique, b.technique_id, b.tactic, b.description, b.scenario];
    for (const c of candidates) {
      const m = typeof c === 'string' ? c.match(re) : null;
      if (m) return m[0].toUpperCase();
    }
  }
  const topLevel = typeof detection.description === 'string' ? detection.description.match(re) : null;
  return topLevel ? topLevel[0].toUpperCase() : null;
}

export function extractPlatforms(detection: any): string[] {
  const set = new Set<string>();
  const device = detection.device ?? {};
  if (device.platform_name) set.add(String(device.platform_name).toLowerCase());
  if (device.os_version) set.add(String(device.os_version));
  for (const b of detection.behaviors ?? []) {
    if (b.platform_name) set.add(String(b.platform_name).toLowerCase());
  }
  return [...set].slice(0, 20);
}

export function extractProducts(detection: any): string[] {
  const set = new Set<string>();
  for (const b of detection.behaviors ?? []) {
    if (b.filename) set.add(String(b.filename));
    if (b.filepath) set.add(String(b.filepath));
  }
  if (detection.device?.product_type_desc) set.add(String(detection.device.product_type_desc));
  return [...set].slice(0, 20);
}

export function extractTtps(detection: any): Array<{ technique: string; tactic?: string }> {
  const ttps: Array<{ technique: string; tactic?: string }> = [];
  for (const b of detection.behaviors ?? []) {
    if (b.technique || b.technique_id) {
      ttps.push({ technique: b.technique ?? b.technique_id, tactic: b.tactic });
    }
  }
  return ttps;
}

function buildTitle(detection: any): string {
  const id = detection.detection_id ?? detection.id ?? 'detection';
  const first = detection.behaviors?.[0];
  const technique = first?.technique ?? first?.scenario ?? detection.max_severity_displayname ?? 'detection';
  return `CrowdStrike: ${technique} (${id})`.substring(0, 240);
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
