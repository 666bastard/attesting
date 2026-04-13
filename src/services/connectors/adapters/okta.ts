import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DEFAULT_FILTER = '(eventType sw "security.") or (outcome.result eq "FAILURE")';
const DEFAULT_LIMIT = 200;

/**
 * Inbound adapter for Okta System Log.
 *
 * Pulls security-relevant events from `/api/v1/logs` and transforms them
 * to `threat_inputs`. Pagination follows the RFC-5988 `Link: rel="next"`
 * cursor pattern that Okta uses.
 *
 * Auth: `Authorization: SSWS <api_token>`.
 * Config: { domain, api_token, filter?, limit? }
 */
export class OktaAdapter extends BaseAdapter {
  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
    if (!this.config.domain || !this.config.api_token) {
      throw new Error('Okta: domain and api_token are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    const base = normalizeDomain(this.config.domain);
    const limit = Number(this.config.limit ?? DEFAULT_LIMIT);
    const filter = this.config.filter ?? DEFAULT_FILTER;

    const params = new URLSearchParams({
      filter,
      limit: String(limit),
      sortOrder: 'ASCENDING',
    });
    if (since) {
      params.set('since', new Date(since).toISOString());
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      params.set('since', d.toISOString());
    }

    let url: string | null = `${base}/api/v1/logs?${params.toString()}`;
    const results: any[] = [];
    let pageCount = 0;
    const maxPages = Number(this.config.max_pages ?? 100);

    while (url && pageCount < maxPages) {
      const { body, linkNext } = await this.authedRequest(url);
      const batch: any[] = Array.isArray(body) ? body : [];
      results.push(...batch);
      if (batch.length === 0) break;
      url = linkNext;
      pageCount++;
    }

    return results;
  }

  transform(event: any): { _table: string; external_id: string; [k: string]: any } | null {
    const uuid = event.uuid ?? event.eventId;
    if (!uuid) return null;

    const eventType = event.eventType ?? 'unknown';
    const outcome = event.outcome?.result ?? null;
    const severity = classifySeverity(eventType, outcome);
    const displayMessage = event.displayMessage ?? eventType;
    const actor = event.actor ?? {};
    const actorName = actor.displayName ?? actor.alternateId ?? 'unknown';
    const actorId = actor.alternateId ?? actor.id ?? actorName;
    const client = event.client ?? {};
    const ip = client.ipAddress ?? null;
    const geo = client.geographicalContext ?? {};
    const country = geo.country ?? null;

    const targets: any[] = Array.isArray(event.target) ? event.target : [];
    const platforms: string[] = [];
    if (country) platforms.push(`geo:${country}`);
    if (client.userAgent?.os) platforms.push(String(client.userAgent.os));

    const products: string[] = [];
    for (const t of targets) {
      const label = t.displayName ?? t.alternateId ?? t.type;
      if (label) products.push(String(label));
    }

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: classifyThreatType(eventType),
      title: `Okta: ${displayMessage}`.substring(0, 240),
      description: `${eventType} by ${actorName} <${actorId}>${ip ? ` from ${ip}` : ''} → ${outcome ?? 'unknown'}`.substring(0, 4000),
      severity,
      cvss_score: null,
      cve_id: null,
      source_ref: `https://${stripProtocol(this.config.domain)}/admin/sysLog/?event=${encodeURIComponent(String(uuid))}`,
      source_name: 'Okta System Log',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(products),
      ttps: '[]',
      iocs: JSON.stringify({
        raw: event,
        actor: { name: actorName, id: actor.id, alternateId: actor.alternateId },
        client: { ip, country, city: geo.city },
        outcome,
        targets: targets.map((t: any) => ({ type: t.type, id: t.id, name: t.displayName })),
      }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(uuid),
      external_source: this.connectorId,
    };
  }

  // ── HTTP ──────────────────────────────────────────────

  private async authedRequest(url: string): Promise<{ body: any; linkNext: string | null }> {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `SSWS ${this.config.api_token}`,
        Accept: 'application/json',
      },
      timeoutMs: this.timeoutMs(),
      adapter: 'Okta',
    });

    if (res.status === 429) {
      const resetHeader = res.headers.get('X-Rate-Limit-Reset');
      let waitMs = 5_000;
      if (resetHeader) {
        const resetSec = Number(resetHeader);
        if (Number.isFinite(resetSec)) {
          waitMs = Math.max(0, resetSec * 1000 - Date.now());
        }
      }
      await sleep(Math.min(Math.max(waitMs, 1000), 60_000));
      return this.authedRequest(url);
    }

    if (res.status === 401) {
      throw new Error('Okta auth failed: 401 (check api_token)');
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Okta API ${res.status}: ${text}`);
    }

    const linkNext = parseLinkNext(res.headers.get('Link'));
    const body = await res.json();
    return { body, linkNext };
  }
}

// ── Helpers (exported for tests) ───────────────────────────

/**
 * Map an Okta eventType + outcome to a CHECK-compliant severity:
 * info | low | medium | high | critical.
 */
export function classifySeverity(eventType: string, outcome: string | null): string {
  const t = String(eventType ?? '').toLowerCase();

  if (t.includes('suspicious') || t.includes('threat') || t.includes('anomalous')) return 'critical';
  if (t.includes('account.lock') || t.includes('mfa.factor.deactivate') || t.includes('policy.evaluate_sign_on')) {
    if (outcome === 'DENY' || outcome === 'FAILURE') return 'high';
    return 'high';
  }
  if (t.includes('user.session.start') && outcome === 'FAILURE') return 'medium';
  if (t.includes('user.authentication') && outcome === 'FAILURE') return 'medium';
  if (outcome === 'FAILURE' || outcome === 'DENY') return 'medium';
  if (t.startsWith('security.')) return 'high';
  if (outcome === 'SUCCESS') return 'info';
  return 'low';
}

/** Pick a CHECK-compliant threat_type for an Okta event. */
export function classifyThreatType(eventType: string): string {
  const t = String(eventType ?? '').toLowerCase();
  if (t.includes('suspicious') || t.includes('threat')) return 'campaign';
  if (t.includes('policy.evaluate_sign_on') || t.includes('authentication') || t.includes('session')) return 'ttp';
  return 'advisory';
}

/**
 * Parse an RFC 5988 Link header and return the URL marked rel="next".
 * Example: `<https://.../logs?after=abc>; rel="next", <...>; rel="self"`
 */
export function parseLinkNext(header: string | null): string | null {
  if (!header) return null;
  const parts = header.split(',');
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i);
    if (m) return m[1];
  }
  return null;
}

function normalizeDomain(domain: string): string {
  const d = domain.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(d)) return d;
  return `https://${d}`;
}

function stripProtocol(domain: string): string {
  return String(domain).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
