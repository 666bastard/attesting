import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DEFAULT_SPL = 'search index=notable | head 1000';
const RESULTS_PAGE = 500;
const POLL_TIMEOUT_MS = 30_000;
const POLL_INITIAL_DELAY_MS = 1_000;
const POLL_MAX_DELAY_MS = 8_000;

/**
 * Inbound adapter for Splunk Enterprise/Cloud via the async search jobs API.
 *
 * Flow:
 *   1. POST /services/search/jobs            — create search job (returns sid)
 *   2. GET  /services/search/jobs/{sid}      — poll until dispatchState=DONE
 *   3. GET  /services/search/jobs/{sid}/results — paginate results
 *
 * Auth: `Authorization: Bearer <token>` (Splunk HTTP API token).
 *
 * Config: { base_url, token, spl?, verify_ssl?, earliest_time?, latest_time? }
 */
export class SplunkAdapter extends BaseAdapter {
  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
    if (!this.config.base_url || !this.config.token) {
      throw new Error('Splunk: base_url and token are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    const base = stripTrailingSlash(this.config.base_url);
    const spl = this.config.spl ?? DEFAULT_SPL;
    const earliest = since
      ? new Date(since).toISOString()
      : this.config.earliest_time ?? '-24h';
    const latest = this.config.latest_time ?? 'now';

    const sid = await this.createJob(base, spl, earliest, latest);
    await this.pollUntilDone(base, sid);
    return this.collectResults(base, sid);
  }

  transform(event: any): { _table: string; external_id: string; [k: string]: any } | null {
    const externalId = event.event_id ?? event._cd ?? event._serial
      ?? (event._time && event.search_name ? `${event.search_name}:${event._time}` : null)
      ?? event.signature_id ?? null;
    if (!externalId) return null;

    const ruleName = event.search_name ?? event.rule_name ?? event.signature ?? 'notable';
    const urgency = event.urgency ?? event.severity ?? event.priority;
    const severity = mapSeverity(urgency);
    const src = event.src ?? event.src_ip ?? null;
    const dest = event.dest ?? event.dest_ip ?? null;
    const securityDomain = event.security_domain ?? null;

    const platforms: string[] = [];
    if (securityDomain) platforms.push(String(securityDomain));
    if (event.dvc) platforms.push(String(event.dvc));

    const products: string[] = [];
    if (src) products.push(String(src));
    if (dest) products.push(String(dest));

    const description = event.description
      ?? event._raw
      ?? event.signature
      ?? `${ruleName} triggered`;

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: classifyThreatType(event),
      title: `Splunk: ${ruleName}`.substring(0, 240),
      description: String(description).substring(0, 4000),
      severity,
      cvss_score: null,
      cve_id: extractCveId(event),
      source_ref: `${stripTrailingSlash(this.config.base_url)}/en-US/app/SplunkEnterpriseSecuritySuite/incident_review?sid=${encodeURIComponent(String(externalId))}`,
      source_name: 'Splunk',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(products),
      ttps: JSON.stringify(extractTtps(event)),
      iocs: JSON.stringify({
        raw: event,
        src,
        dest,
        urgency,
        security_domain: securityDomain,
      }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(externalId),
      external_source: this.connectorId,
    };
  }

  // ── Job lifecycle ─────────────────────────────────────

  private async createJob(base: string, spl: string, earliest: string, latest: string): Promise<string> {
    const body = new URLSearchParams({
      search: spl.startsWith('search ') || spl.startsWith('|') ? spl : `search ${spl}`,
      output_mode: 'json',
      earliest_time: earliest,
      latest_time: latest,
      exec_mode: 'normal',
    });

    const data = await this.authedRequest(`${base}/services/search/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const sid = data?.sid ?? data?.entry?.[0]?.name;
    if (!sid) throw new Error('Splunk: search job created but sid missing from response');
    return String(sid);
  }

  private async pollUntilDone(base: string, sid: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let delay = POLL_INITIAL_DELAY_MS;

    while (Date.now() < deadline) {
      const data = await this.authedRequest(
        `${base}/services/search/jobs/${encodeURIComponent(sid)}?output_mode=json`,
        { method: 'GET' },
      );
      const content = data?.entry?.[0]?.content ?? data?.content ?? data;
      const state = content?.dispatchState ?? content?.state;

      if (state === 'DONE') return;
      if (state === 'FAILED' || state === 'QUIT' || state === 'CANCELLED') {
        throw new Error(`Splunk search job ${sid} finished in state ${state}`);
      }

      await sleep(delay);
      delay = Math.min(delay * 2, POLL_MAX_DELAY_MS);
    }
    throw new Error(`Splunk search job ${sid} did not complete within ${POLL_TIMEOUT_MS}ms`);
  }

  private async collectResults(base: string, sid: string): Promise<any[]> {
    const out: any[] = [];
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        output_mode: 'json',
        offset: String(offset),
        count: String(RESULTS_PAGE),
      });
      const data = await this.authedRequest(
        `${base}/services/search/jobs/${encodeURIComponent(sid)}/results?${params.toString()}`,
        { method: 'GET' },
      );
      const batch: any[] = data?.results ?? [];
      out.push(...batch);
      if (batch.length < RESULTS_PAGE) break;
      offset += RESULTS_PAGE;
    }
    return out;
  }

  // ── HTTP ──────────────────────────────────────────────

  private async authedRequest(url: string, init: RequestInit): Promise<any> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string>) ?? {}),
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/json',
    };

    const res = await fetchWithTimeout(url, {
      ...init,
      headers,
      timeoutMs: this.timeoutMs(),
      adapter: 'Splunk',
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 5);
      await sleep(Math.min(retryAfter, 60) * 1000);
      return this.authedRequest(url, init);
    }

    if (res.status === 401) {
      throw new Error('Splunk auth failed: 401 (check token)');
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Splunk API ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// ── Helpers (exported for tests) ───────────────────────────

/** Map Splunk urgency/severity to threat_inputs severity CHECK values. */
export function mapSeverity(value: unknown): string {
  const s = String(value ?? '').toLowerCase();
  if (s.includes('critical')) return 'critical';
  if (s.includes('high')) return 'high';
  if (s.includes('medium')) return 'medium';
  if (s.includes('low')) return 'low';
  if (s.includes('info')) return 'info';
  return 'medium';
}

/** Pick a CHECK-compliant threat_type from event metadata. */
export function classifyThreatType(event: any): string {
  const domain = String(event.security_domain ?? '').toLowerCase();
  const signature = String(event.signature ?? '').toLowerCase();
  if (domain.includes('endpoint') || signature.includes('malware') || signature.includes('ransom')) return 'malware';
  if (domain.includes('threat') || signature.includes('exploit')) return 'exploit';
  if (signature.includes('cve')) return 'vulnerability';
  if (domain.includes('network') || domain.includes('access')) return 'ttp';
  return 'advisory';
}

export function extractCveId(event: any): string | null {
  const re = /CVE-\d{4}-\d{4,7}/i;
  for (const k of ['signature', 'rule_name', 'search_name', '_raw', 'description']) {
    const v = event?.[k];
    const m = typeof v === 'string' ? v.match(re) : null;
    if (m) return m[0].toUpperCase();
  }
  return null;
}

export function extractTtps(event: any): string[] {
  const raw = event?.annotations?.mitre_attack ?? event?.mitre_technique ?? event?.ttp;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [String(raw)];
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
