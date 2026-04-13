import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DEFAULT_LIMIT = 200;
const SECURITY_INCIDENT_TABLE = 'sn_si_incident';
const INCIDENT_TABLE = 'incident';

/**
 * Inbound adapter for ServiceNow Table API.
 *
 * Pulls incidents (prefers Security Incident Response table `sn_si_incident`
 * with graceful fallback to the generic `incident` table) and transforms
 * them to `threat_inputs` rows.
 *
 * Config: { instance_url, username, password, table? }
 *   - instance_url: e.g. https://mycompany.service-now.com
 *   - table: override detection (defaults to auto-probe)
 *
 * Auth: HTTP Basic (ServiceNow's most portable Table API auth).
 */
export class ServiceNowAdapter extends BaseAdapter {
  private resolvedTable: string | null = null;

  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
    if (!this.config.instance_url || !this.config.username || !this.config.password) {
      throw new Error('ServiceNow: instance_url, username, and password are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    const table = await this.resolveTable();
    const results: any[] = [];
    let offset = 0;
    const limit = Number(this.config.limit ?? DEFAULT_LIMIT);

    const queryParts: string[] = [];
    if (since) {
      queryParts.push(`sys_updated_on>${formatSnDate(since)}`);
    }
    if (this.config.sysparm_query) {
      queryParts.push(String(this.config.sysparm_query));
    }
    queryParts.push('ORDERBYsys_updated_on');
    const sysparmQuery = queryParts.join('^');

    while (true) {
      const params = new URLSearchParams({
        sysparm_limit: String(limit),
        sysparm_offset: String(offset),
        sysparm_display_value: 'all',
        sysparm_exclude_reference_link: 'true',
        sysparm_query: sysparmQuery,
      });

      const url = `${stripTrailingSlash(this.config.instance_url)}/api/now/table/${table}?${params.toString()}`;
      const data = await this.authedRequest(url);
      const batch: any[] = data.result ?? [];
      results.push(...batch);

      if (batch.length < limit) break;
      offset += limit;
    }

    return results;
  }

  transform(incident: any): { _table: string; external_id: string; [k: string]: any } | null {
    const sysId = pickValue(incident.sys_id);
    const number = pickValue(incident.number);
    const externalId = sysId ?? number;
    if (!externalId) return null;

    const priority = pickValue(incident.priority);
    const snSeverity = pickValue(incident.severity);
    const severity = mapSeverity(priority, snSeverity);

    const shortDescription = pickValue(incident.short_description) ?? '';
    const description = pickValue(incident.description) ?? shortDescription;
    const category = pickValue(incident.category);
    const subcategory = pickValue(incident.subcategory);
    const state = pickValue(incident.state);
    const assignmentGroup = pickDisplay(incident.assignment_group);

    const title = `ServiceNow ${number ?? externalId}: ${shortDescription}`.substring(0, 240);

    const platforms: string[] = [];
    if (category) platforms.push(category);
    if (subcategory) platforms.push(subcategory);

    const products: string[] = [];
    const cmdbCi = pickDisplay(incident.cmdb_ci);
    if (cmdbCi) products.push(cmdbCi);

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: 'advisory',
      title,
      description,
      severity,
      cvss_score: null,
      cve_id: null,
      source_ref: `${stripTrailingSlash(this.config.instance_url)}/nav_to.do?uri=${this.resolvedTable ?? INCIDENT_TABLE}.do?sys_id=${externalId}`,
      source_name: 'ServiceNow ITSM',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(products),
      ttps: '[]',
      iocs: JSON.stringify({
        raw: incident,
        state,
        priority,
        assignment_group: assignmentGroup,
      }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(externalId),
      external_source: this.connectorId,
    };
  }

  // ── Auth / HTTP ───────────────────────────────────────

  private authHeader(): string {
    const creds = `${this.config.username}:${this.config.password}`;
    return `Basic ${Buffer.from(creds, 'utf-8').toString('base64')}`;
  }

  private async authedRequest(url: string, retried = false): Promise<any> {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/json',
      },
      timeoutMs: this.timeoutMs(),
      adapter: 'ServiceNow',
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 5);
      await new Promise(r => setTimeout(r, Math.min(retryAfter, 60) * 1000));
      return this.authedRequest(url, retried);
    }

    if (res.status === 401) {
      throw new Error(`ServiceNow auth failed: 401 (check username/password)`);
    }

    if (res.status === 404 && !retried) {
      throw new Error(`ServiceNow table not found: ${url}`);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`ServiceNow API ${res.status}: ${text}`);
    }

    return res.json();
  }

  private async resolveTable(): Promise<string> {
    if (this.resolvedTable) return this.resolvedTable;
    if (this.config.table) {
      this.resolvedTable = String(this.config.table);
      return this.resolvedTable;
    }

    const probeUrl = `${stripTrailingSlash(this.config.instance_url)}/api/now/table/${SECURITY_INCIDENT_TABLE}?sysparm_limit=1`;
    try {
      await this.authedRequest(probeUrl, true);
      this.resolvedTable = SECURITY_INCIDENT_TABLE;
    } catch {
      this.resolvedTable = INCIDENT_TABLE;
    }
    return this.resolvedTable;
  }
}

// ── Transform helpers (exported for tests) ─────────────────

/**
 * Map ServiceNow priority (1=Critical … 5=Planning) and severity to
 * the threat_inputs severity CHECK constraint: info|low|medium|high|critical.
 */
export function mapSeverity(priority: unknown, snSeverity?: unknown): string {
  const p = parseSnNumber(priority);
  if (p !== null) {
    if (p <= 1) return 'critical';
    if (p === 2) return 'high';
    if (p === 3) return 'medium';
    if (p === 4) return 'low';
    return 'info';
  }
  const s = parseSnNumber(snSeverity);
  if (s !== null) {
    if (s <= 1) return 'critical';
    if (s === 2) return 'high';
    if (s === 3) return 'medium';
    return 'low';
  }
  const label = String(priority ?? snSeverity ?? '').toLowerCase();
  if (label.includes('critical')) return 'critical';
  if (label.includes('high')) return 'high';
  if (label.includes('moderate') || label.includes('medium')) return 'medium';
  if (label.includes('low')) return 'low';
  if (label.includes('planning') || label.includes('info')) return 'info';
  return 'medium';
}

/** ServiceNow Table API with sysparm_display_value=all returns
 *  `{ value, display_value }` pairs. Extract the machine value. */
export function pickValue(field: any): string | null {
  if (field == null) return null;
  if (typeof field === 'object') {
    if (typeof field.value === 'string' && field.value !== '') return field.value;
    if (typeof field.display_value === 'string' && field.display_value !== '') return field.display_value;
    return null;
  }
  return field === '' ? null : String(field);
}

/** Prefer the display_value when available (for reference fields). */
export function pickDisplay(field: any): string | null {
  if (field == null) return null;
  if (typeof field === 'object') {
    if (typeof field.display_value === 'string' && field.display_value !== '') return field.display_value;
    if (typeof field.value === 'string' && field.value !== '') return field.value;
    return null;
  }
  return field === '' ? null : String(field);
}

function parseSnNumber(v: unknown): number | null {
  if (v == null) return null;
  const raw = typeof v === 'object' ? (v as any).value ?? (v as any).display_value : v;
  const n = Number(String(raw).split(/[^\d]/)[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ServiceNow expects dates as `YYYY-MM-DD HH:MM:SS` (UTC). */
export function formatSnDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
