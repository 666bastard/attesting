import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const RISK_DETECTIONS_PATH = '/identityProtection/riskDetections';
const DEFAULT_FILTER = "(riskState eq 'atRisk') or (riskState eq 'confirmedCompromised')";
const DEFAULT_TOP = 100;

/**
 * Inbound adapter for Microsoft Entra ID (Azure AD) Identity Protection.
 *
 * Pulls risk detections via Microsoft Graph and maps them to `threat_inputs`.
 *
 * Auth: OAuth2 client_credentials against Microsoft Identity Platform
 *       (tenant-specific `/oauth2/v2.0/token` endpoint, graph `.default` scope).
 *
 * Pagination: follows `@odata.nextLink` cursors until absent.
 * Incremental: `$filter` on `detectedDateTime ge {since}`.
 *
 * Config: { tenant_id, client_id, client_secret, filter?, graph_base? }
 */
export class AzureAdAdapter extends BaseAdapter {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, { graph_base: GRAPH_BASE, ...config });
    if (!this.config.tenant_id || !this.config.client_id || !this.config.client_secret) {
      throw new Error('Azure AD: tenant_id, client_id, and client_secret are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    await this.ensureToken();

    const filterParts: string[] = [];
    const baseFilter = this.config.filter ?? DEFAULT_FILTER;
    if (baseFilter) filterParts.push(`(${baseFilter})`);
    if (since) {
      filterParts.push(`detectedDateTime ge ${new Date(since).toISOString()}`);
    }

    const params = new URLSearchParams({
      $top: String(this.config.top ?? DEFAULT_TOP),
      $orderby: 'detectedDateTime asc',
    });
    if (filterParts.length > 0) params.set('$filter', filterParts.join(' and '));

    let url: string | null = `${this.config.graph_base}${RISK_DETECTIONS_PATH}?${params.toString()}`;
    const results: any[] = [];
    let pageCount = 0;
    const maxPages = Number(this.config.max_pages ?? 100);

    while (url && pageCount < maxPages) {
      const body: any = await this.authedRequest(url);
      const batch: any[] = body?.value ?? [];
      results.push(...batch);
      url = body?.['@odata.nextLink'] ?? null;
      pageCount++;
    }

    return results;
  }

  transform(detection: any): { _table: string; external_id: string; [k: string]: any } | null {
    const externalId = detection.id ?? detection.requestId;
    if (!externalId) return null;

    const riskLevel = detection.riskLevel ?? 'none';
    const riskEventType = detection.riskEventType ?? 'unknown';
    const severity = mapSeverity(riskLevel);
    const upn = detection.userPrincipalName ?? detection.userDisplayName ?? 'unknown';
    const displayName = detection.userDisplayName ?? upn;
    const ip = detection.ipAddress ?? null;
    const loc = detection.location ?? {};
    const country = loc.countryOrRegion ?? null;
    const city = loc.city ?? null;

    const platforms: string[] = [];
    if (country) platforms.push(`geo:${country}`);
    if (detection.detectionTimingType) platforms.push(String(detection.detectionTimingType));

    const products: string[] = [];
    if (ip) products.push(ip);
    if (detection.source) products.push(String(detection.source));

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: classifyThreatType(riskEventType),
      title: `Entra ID risk: ${riskEventType} (${riskLevel})`.substring(0, 240),
      description: `${riskEventType} on ${displayName} <${upn}>${ip ? ` from ${ip}` : ''}${country ? ` (${city ?? ''}${city ? ', ' : ''}${country})` : ''} — state=${detection.riskState ?? 'unknown'}`.substring(0, 4000),
      severity,
      cvss_score: null,
      cve_id: null,
      source_ref: `https://portal.azure.com/#blade/Microsoft_AAD_IAM/IdentityProtectionMenuBlade/RiskDetections`,
      source_name: 'Microsoft Entra ID',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(products),
      ttps: JSON.stringify([riskEventType]),
      iocs: JSON.stringify({
        raw: detection,
        user: { principal: upn, displayName, id: detection.userId },
        client: { ip, country, city },
        riskLevel,
        riskState: detection.riskState,
        riskEventType,
        detectionTimingType: detection.detectionTimingType,
        activity: detection.activity,
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

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenant_id)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const res = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      timeoutMs: this.timeoutMs(),
      adapter: 'Azure AD',
    });

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Azure AD auth failed: ${res.status} ${text}`);
    }

    const data: any = await res.json();
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
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
      adapter: 'Azure AD',
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

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Microsoft Graph ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// ── Helpers (exported for tests) ───────────────────────────

/**
 * Map Entra ID risk level (none|low|medium|high|hidden) to a CHECK-compliant
 * threat_inputs severity: info | low | medium | high | critical.
 */
export function mapSeverity(riskLevel: unknown): string {
  const r = String(riskLevel ?? '').toLowerCase();
  if (r === 'high') return 'high';
  if (r === 'medium') return 'medium';
  if (r === 'low') return 'low';
  if (r === 'hidden') return 'info';
  if (r === 'none') return 'info';
  return 'medium';
}

/**
 * Map Entra ID riskEventType to a CHECK-compliant threat_type.
 * CHECK set: vulnerability|exploit|campaign|malware|ttp|advisory|regulatory|best_practice
 */
export function classifyThreatType(riskEventType: unknown): string {
  const e = String(riskEventType ?? '').toLowerCase();
  if (e.includes('leakedcredential')) return 'exploit';
  if (e.includes('password') && e.includes('spray')) return 'exploit';
  if (e.includes('maliciousip') || e.includes('botnet') || e.includes('anonymizedip')) return 'campaign';
  if (e.includes('malware')) return 'malware';
  if (e.includes('impossibletravel') || e.includes('unfamiliar') || e.includes('anomalous') || e.includes('suspicious')) return 'ttp';
  if (e.includes('investigationsthreatintelligence') || e.includes('threatintelligence')) return 'campaign';
  return 'advisory';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
