import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_JQL = 'issuetype in (Bug, Task) AND labels in (security, vulnerability, cve)';
const FIELDS = [
  'summary', 'description', 'priority', 'status', 'labels',
  'components', 'assignee', 'reporter', 'project', 'issuetype',
  'created', 'updated', 'resolution',
];

/**
 * Inbound adapter for Atlassian Jira Cloud.
 *
 * Pulls security-labeled issues via the Jira REST API v3 search endpoint
 * and transforms them to `threat_inputs` rows.
 *
 * Auth: HTTP Basic with `email:api_token` (Atlassian API token).
 * Config: { base_url, email, api_token, jql?, max_results? }
 */
export class JiraAdapter extends BaseAdapter {
  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
    if (!this.config.base_url || !this.config.email || !this.config.api_token) {
      throw new Error('Jira: base_url, email, and api_token are required');
    }
  }

  async fetch(since: string | null): Promise<any[]> {
    const results: any[] = [];
    const maxResults = Number(this.config.max_results ?? DEFAULT_MAX_RESULTS);
    const jql = buildJql(this.config.jql ?? DEFAULT_JQL, since);
    let startAt = 0;
    let total = Infinity;

    while (startAt < total) {
      const body = JSON.stringify({ jql, startAt, maxResults, fields: FIELDS });
      const url = `${stripTrailingSlash(this.config.base_url)}/rest/api/3/search`;
      const data = await this.authedRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const issues: any[] = data.issues ?? [];
      results.push(...issues);
      total = typeof data.total === 'number' ? data.total : results.length;
      startAt += maxResults;
      if (issues.length < maxResults) break;
    }

    return results;
  }

  transform(issue: any): { _table: string; external_id: string; [k: string]: any } | null {
    const key = issue.key ?? issue.id;
    if (!key) return null;

    const fields = issue.fields ?? {};
    const summary = fields.summary ?? '';
    const description = adfToText(fields.description) || summary;
    const priorityName = fields.priority?.name;
    const severity = mapSeverity(priorityName);
    const labels: string[] = Array.isArray(fields.labels) ? fields.labels : [];
    const components: string[] = (fields.components ?? []).map((c: any) => c.name).filter(Boolean);
    const projectKey = fields.project?.key ?? null;
    const status = fields.status?.name ?? null;
    const assignee = fields.assignee?.displayName ?? null;

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'internal',
      threat_type: classifyThreatType(labels),
      title: `Jira ${key}: ${summary}`.substring(0, 240),
      description: description.substring(0, 4000),
      severity,
      cvss_score: null,
      cve_id: extractCveId(summary, description, labels),
      source_ref: `${stripTrailingSlash(this.config.base_url)}/browse/${key}`,
      source_name: 'Jira',
      affected_platforms: JSON.stringify(components),
      affected_products: JSON.stringify(projectKey ? [projectKey] : []),
      ttps: JSON.stringify(labels),
      iocs: JSON.stringify({
        raw: issue,
        status,
        priority: priorityName,
        assignee,
        labels,
      }),
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: String(key),
      external_source: this.connectorId,
    };
  }

  // ── HTTP ──────────────────────────────────────────────

  private authHeader(): string {
    const creds = `${this.config.email}:${this.config.api_token}`;
    return `Basic ${Buffer.from(creds, 'utf-8').toString('base64')}`;
  }

  private async authedRequest(url: string, init: RequestInit): Promise<any> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string>) ?? {}),
      Authorization: this.authHeader(),
      Accept: 'application/json',
    };

    const res = await fetchWithTimeout(url, {
      ...init,
      headers,
      timeoutMs: this.timeoutMs(),
      adapter: 'Jira',
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? 5);
      await new Promise(r => setTimeout(r, Math.min(retryAfter, 60) * 1000));
      return this.authedRequest(url, init);
    }

    if (res.status === 401) {
      throw new Error('Jira auth failed: 401 (check email/api_token)');
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`Jira API ${res.status}: ${text}`);
    }

    return res.json();
  }
}

// ── Helpers (exported for tests) ───────────────────────────

/**
 * Map Jira priority names to the threat_inputs severity CHECK set:
 * info | low | medium | high | critical.
 */
export function mapSeverity(priority: unknown): string {
  const p = String(priority ?? '').toLowerCase();
  if (p === 'highest' || p.includes('critical') || p.includes('blocker')) return 'critical';
  if (p === 'high' || p.includes('major')) return 'high';
  if (p === 'medium' || p.includes('moderate')) return 'medium';
  if (p === 'low' || p.includes('minor')) return 'low';
  if (p === 'lowest' || p.includes('trivial') || p.includes('planning')) return 'info';
  return 'medium';
}

/** Label-driven classification into a threat_type CHECK value. */
export function classifyThreatType(labels: string[]): string {
  const joined = labels.map(l => l.toLowerCase()).join(' ');
  if (/\b(cve|vulnerability|vuln)\b/.test(joined)) return 'vulnerability';
  if (/\b(exploit|rce)\b/.test(joined)) return 'exploit';
  if (/\b(malware|ransomware)\b/.test(joined)) return 'malware';
  if (/\b(ttp|mitre)\b/.test(joined)) return 'ttp';
  return 'advisory';
}

/** Extract CVE ID from summary/description/labels if present. */
export function extractCveId(summary: string, description: string, labels: string[]): string | null {
  const re = /CVE-\d{4}-\d{4,7}/i;
  for (const src of [summary, description, ...labels]) {
    const m = typeof src === 'string' ? src.match(re) : null;
    if (m) return m[0].toUpperCase();
  }
  return null;
}

/**
 * Convert Jira's Atlassian Document Format (ADF) description to plain text.
 * Walks the `content` tree and concatenates text nodes with paragraph breaks.
 * Accepts already-plain strings too.
 */
export function adfToText(doc: any): string {
  if (doc == null) return '';
  if (typeof doc === 'string') return doc;
  if (typeof doc !== 'object') return String(doc);

  const out: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (typeof node.text === 'string') {
      out.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
      if (node.type === 'paragraph' || node.type === 'heading') out.push('\n');
    }
  };
  walk(doc);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Compose the final JQL: base filter AND updated >= "{since}" ORDER BY updated.
 */
export function buildJql(base: string, since: string | null): string {
  const parts: string[] = [];
  if (base && base.trim()) parts.push(`(${base.trim()})`);
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) {
      const formatted = d.toISOString().slice(0, 16).replace('T', ' ');
      parts.push(`updated >= "${formatted}"`);
    }
  }
  const where = parts.join(' AND ');
  return where ? `${where} ORDER BY updated ASC` : 'ORDER BY updated ASC';
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).substring(0, 200); } catch { return ''; }
}
