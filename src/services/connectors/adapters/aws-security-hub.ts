import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { signRequest } from '../utils/aws-sigv4.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const SERVICE = 'securityhub';
const ACTION_TARGET = 'SecurityHubAPIService.GetFindings';
const MAX_PAGE = 100;

/**
 * Inbound adapter for AWS Security Hub findings (ASFF).
 *
 * Auth: AWS Signature V4 against `securityhub.{region}.amazonaws.com`.
 * Fetch: POST /findings (GetFindings) with Filters + NextToken pagination.
 * Target: `threat_inputs`.
 *
 * Config: { region, access_key_id, secret_access_key, session_token?, filters?, max_results? }
 */
export class AwsSecurityHubAdapter extends BaseAdapter {
  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
    if (!this.config.region || !this.config.access_key_id || !this.config.secret_access_key) {
      throw new Error('AWS Security Hub: region, access_key_id, and secret_access_key are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    const endpoint = `https://securityhub.${this.config.region}.amazonaws.com/findings`;
    const maxResults = Number(this.config.max_results ?? MAX_PAGE);
    const filters = buildFilters(this.config.filters, since);

    const results: any[] = [];
    let nextToken: string | undefined;
    let pageCount = 0;
    const maxPages = Number(this.config.max_pages ?? 100);

    while (pageCount < maxPages) {
      const payload: Record<string, any> = { Filters: filters, MaxResults: maxResults };
      if (nextToken) payload.NextToken = nextToken;

      const data = await this.signedRequest(endpoint, JSON.stringify(payload));
      const findings: any[] = data?.Findings ?? [];
      results.push(...findings);

      nextToken = data?.NextToken;
      pageCount++;
      if (!nextToken) break;
    }

    return results;
  }

  transform(finding: any): { _table: string; external_id: string; [k: string]: any } | null {
    const externalId = finding.Id ?? finding.id;
    if (!externalId) return null;

    const severityLabel = finding.Severity?.Label ?? null;
    const severity = mapSeverity(severityLabel, finding.Severity?.Normalized);
    const typesArr: string[] = Array.isArray(finding.Types) ? finding.Types : [];
    const threatType = classifyThreatType(typesArr);

    const resources: any[] = Array.isArray(finding.Resources) ? finding.Resources : [];
    const resourceIds = resources.map(r => r.Id).filter(Boolean);
    const resourceTypes = resources.map(r => r.Type).filter(Boolean);

    const title = `AWS Security Hub: ${finding.Title ?? 'Finding'}`.substring(0, 240);
    const description = String(finding.Description ?? finding.Title ?? '').substring(0, 4000);

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: threatType,
      title,
      description,
      severity,
      cvss_score: null,
      cve_id: extractCveId(finding),
      source_ref: finding.SourceUrl ?? `https://console.aws.amazon.com/securityhub/home?region=${this.config.region}#/findings`,
      source_name: finding.ProductName ?? 'AWS Security Hub',
      affected_platforms: JSON.stringify(resourceTypes.slice(0, 20)),
      affected_products: JSON.stringify(resourceIds.slice(0, 20)),
      ttps: JSON.stringify(typesArr),
      iocs: JSON.stringify({
        raw: finding,
        generatorId: finding.GeneratorId,
        productName: finding.ProductName,
        compliance: finding.Compliance?.Status ?? null,
        recordState: finding.RecordState,
        workflowStatus: finding.Workflow?.Status,
        remediation: finding.Remediation?.Recommendation?.Text ?? null,
        resourceIds,
      }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(externalId),
      external_source: this.connectorId,
    };
  }

  // ── HTTP ──────────────────────────────────────────────

  private async signedRequest(url: string, body: string, retried = false): Promise<any> {
    const signed = signRequest({
      method: 'POST',
      url,
      region: this.config.region,
      service: SERVICE,
      body,
      headers: { 'X-Amz-Target': ACTION_TARGET },
      accessKeyId: this.config.access_key_id,
      secretAccessKey: this.config.secret_access_key,
      sessionToken: this.config.session_token,
    });

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: signed.headers,
      body,
      timeoutMs: this.timeoutMs(),
      adapter: 'AWS Security Hub',
    });

    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 2);
      await sleep(Math.min(retryAfter, 60) * 1000);
      return this.signedRequest(url, body, retried);
    }

    if (res.status === 403 && !retried) {
      // One-shot retry in case of clock skew; surface on second failure.
      return this.signedRequest(url, body, true);
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`AWS Security Hub auth failed: ${res.status} (check credentials and IAM perms)`);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`AWS Security Hub API ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// ── Helpers (exported for tests) ───────────────────────────

/**
 * Map ASFF SeverityLabel → threat_inputs severity CHECK values.
 * Falls back to Normalized score (0-100) if label missing.
 */
export function mapSeverity(label: unknown, normalized?: unknown): string {
  const l = String(label ?? '').toUpperCase();
  if (l === 'CRITICAL') return 'critical';
  if (l === 'HIGH') return 'high';
  if (l === 'MEDIUM') return 'medium';
  if (l === 'LOW') return 'low';
  if (l === 'INFORMATIONAL') return 'info';
  const n = Number(normalized);
  if (Number.isFinite(n)) {
    if (n >= 90) return 'critical';
    if (n >= 70) return 'high';
    if (n >= 40) return 'medium';
    if (n >= 1) return 'low';
    return 'info';
  }
  return 'medium';
}

/**
 * Map ASFF Types[] (namespaced like "TTPs/Initial Access/...") to a CHECK-compliant
 * threat_type. Takes the first namespace that matches.
 */
export function classifyThreatType(types: string[]): string {
  for (const t of types) {
    const top = String(t).split('/')[0].toLowerCase();
    if (top.includes('ttps')) return 'ttp';
    if (top.includes('unusual behaviors')) return 'ttp';
    if (top.includes('effects')) return 'malware';
    if (top.includes('software and configuration checks')) return 'vulnerability';
    if (top.includes('sensitive data identifications')) return 'advisory';
  }
  return 'advisory';
}

export function extractCveId(finding: any): string | null {
  const re = /CVE-\d{4}-\d{4,7}/i;
  for (const src of [finding.Title, finding.Description, ...(finding.Types ?? [])]) {
    const m = typeof src === 'string' ? src.match(re) : null;
    if (m) return m[0].toUpperCase();
  }
  return null;
}

/**
 * Compose a Security Hub Filters object from optional user overrides and
 * incremental `since` timestamp. Defaults to active, open, non-informational.
 */
export function buildFilters(userFilters: any, since: string | null): Record<string, any> {
  const filters: Record<string, any> = userFilters && typeof userFilters === 'object' ? { ...userFilters } : {};

  if (!filters.RecordState) {
    filters.RecordState = [{ Value: 'ACTIVE', Comparison: 'EQUALS' }];
  }
  if (!filters.WorkflowStatus) {
    filters.WorkflowStatus = [
      { Value: 'NEW', Comparison: 'EQUALS' },
      { Value: 'NOTIFIED', Comparison: 'EQUALS' },
    ];
  }
  if (!filters.SeverityLabel) {
    filters.SeverityLabel = [
      { Value: 'INFORMATIONAL', Comparison: 'NOT_EQUALS' },
    ];
  }
  if (since) {
    filters.UpdatedAt = [{ Start: new Date(since).toISOString(), End: new Date().toISOString() }];
  }
  return filters;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
