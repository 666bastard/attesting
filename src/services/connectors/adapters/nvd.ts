import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { checkAutoCorroboration } from '../../intel/auto-corroboration.js';

const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

/**
 * Inbound adapter for the NIST National Vulnerability Database.
 * Transforms CVE records into threat_inputs and auto-corroborates
 * against provisional manual intel.
 *
 * Config: { api_key?: string }
 * Rate limits: 5 req/30s without key, 50 req/30s with key.
 */
export class NVDAdapter extends BaseAdapter {
  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, config);
  }

  async fetch(since: string | null): Promise<any[]> {
    const results: any[] = [];
    let startIndex = 0;
    const pageSize = 2000;

    const params = new URLSearchParams({ resultsPerPage: String(pageSize) });

    if (since) {
      const start = new Date(since).toISOString().replace(/\.\d{3}Z$/, '.000');
      const end = new Date().toISOString().replace(/\.\d{3}Z$/, '.000');
      params.set('lastModStartDate', start);
      params.set('lastModEndDate', end);
    } else {
      // Full sync: last 30 days to avoid pulling entire NVD
      const start = new Date();
      start.setDate(start.getDate() - 30);
      params.set('lastModStartDate', start.toISOString().replace(/\.\d{3}Z$/, '.000'));
      params.set('lastModEndDate', new Date().toISOString().replace(/\.\d{3}Z$/, '.000'));
    }

    let totalResults = Infinity;

    while (startIndex < totalResults) {
      params.set('startIndex', String(startIndex));
      const url = `${NVD_API}?${params.toString()}`;

      const headers: Record<string, string> = {};
      if (this.config.api_key) {
        headers['apiKey'] = this.config.api_key;
      }

      const res = await fetchWithTimeout(url, { headers, timeoutMs: this.timeoutMs(), adapter: 'NVD' });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? 6);
        await new Promise(r => setTimeout(r, Math.min(retryAfter, 60) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`NVD API error: ${res.status} ${res.statusText}`);

      const data: any = await res.json();
      totalResults = data.totalResults ?? 0;

      for (const item of data.vulnerabilities ?? []) {
        results.push(item.cve);
      }

      startIndex += pageSize;

      // Rate limit: wait between pages
      if (startIndex < totalResults) {
        const delay = this.config.api_key ? 600 : 6000;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return results;
  }

  transform(cve: any): { _table: string; external_id: string; [k: string]: any } {
    const description = cve.descriptions?.find((d: any) => d.lang === 'en')?.value
      ?? cve.descriptions?.[0]?.value ?? '';

    const cvssData = cve.metrics?.cvssMetricV31?.[0]?.cvssData
      ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData
      ?? cve.metrics?.cvssMetricV2?.[0]?.cvssData;

    const baseScore = cvssData?.baseScore ?? null;
    const severity = cvssToSeverity(baseScore);
    const platforms = extractPlatforms(cve);

    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'nvd',
      threat_type: 'vulnerability',
      title: `NVD: ${cve.id} — ${description.substring(0, 120)}`,
      description,
      severity,
      cvss_score: baseScore,
      cve_id: cve.id,
      source_ref: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      source_name: 'NIST NVD',
      affected_platforms: JSON.stringify(platforms),
      affected_products: JSON.stringify(extractProducts(cve)),
      ttps: '[]',
      iocs: null,
      is_corroborated: 0,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: cve.id,
      external_source: this.connectorId,
    };
  }

  /**
   * Override sync to run auto-corroboration after ingesting new CVEs.
   */
  async sync(syncType: 'full' | 'incremental' = 'incremental'): Promise<any> {
    const stats = await super.sync(syncType);

    // After sync, check new threats against provisional intel
    if (stats.created > 0) {
      const newThreats = this.db.prepare(`
        SELECT id FROM threat_inputs
        WHERE external_source = ? AND channel = 'nvd'
        ORDER BY ingested_at DESC LIMIT ?
      `).all(this.connectorId, stats.created) as Array<{ id: string }>;

      for (const threat of newThreats) {
        checkAutoCorroboration(this.db, threat.id);
      }
    }

    return stats;
  }
}

/** Map CVSS base score to severity string. */
export function cvssToSeverity(score: number | null): string {
  if (score === null || score === undefined) return 'medium';
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  return 'low';
}

/** Extract platform names from CPE configurations. */
function extractPlatforms(cve: any): string[] {
  const platforms = new Set<string>();

  const configs = cve.configurations ?? [];
  for (const config of configs) {
    for (const node of config.nodes ?? []) {
      for (const match of node.cpeMatch ?? []) {
        const cpe = match.criteria ?? '';
        // CPE format: cpe:2.3:a:vendor:product:version:...
        const parts = cpe.split(':');
        if (parts.length >= 5) {
          const vendor = parts[3];
          const product = parts[4];
          if (vendor && vendor !== '*') platforms.add(vendor);
          if (product && product !== '*') platforms.add(product);
        }
      }
    }
  }

  return [...platforms].slice(0, 20);
}

/** Extract product names from CPE configurations. */
function extractProducts(cve: any): string[] {
  const products = new Set<string>();

  const configs = cve.configurations ?? [];
  for (const config of configs) {
    for (const node of config.nodes ?? []) {
      for (const match of node.cpeMatch ?? []) {
        const cpe = match.criteria ?? '';
        const parts = cpe.split(':');
        if (parts.length >= 5 && parts[4] !== '*') {
          products.add(parts[4]);
        }
      }
    }
  }

  return [...products].slice(0, 20);
}
