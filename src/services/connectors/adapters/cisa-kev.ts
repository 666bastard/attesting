import type Database from 'better-sqlite3';
import { BaseAdapter } from '../base-adapter.js';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const DEFAULT_FEED_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

/**
 * Inbound adapter for the CISA Known Exploited Vulnerabilities catalog.
 * Transforms KEV entries into threat_inputs records.
 */
export class CISAKEVAdapter extends BaseAdapter {
  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    super(db, connectorId, { feed_url: DEFAULT_FEED_URL, ...config });
  }

  async fetch(since: string | null): Promise<any[]> {
    const res = await fetchWithTimeout(this.config.feed_url, {
      timeoutMs: this.timeoutMs(),
      adapter: 'CISA KEV',
    });
    if (!res.ok) throw new Error(`CISA KEV fetch failed: ${res.status}`);

    const data: any = await res.json();
    let vulns: any[] = data.vulnerabilities ?? [];

    if (since) {
      const sinceDate = new Date(since);
      vulns = vulns.filter((v: any) => new Date(v.dateAdded) > sinceDate);
    }

    return vulns;
  }

  transform(vuln: any): { _table: string; external_id: string; [k: string]: any } {
    return {
      _table: 'threat_inputs',
      id: null as any,
      channel: 'cisa_kev',
      threat_type: 'vulnerability',
      title: `KEV: ${vuln.cveID} — ${vuln.vulnerabilityName}`,
      description: vuln.shortDescription,
      severity: vuln.knownRansomwareCampaignUse === 'Known' ? 'critical' : 'high',
      cvss_score: null,
      cve_id: vuln.cveID,
      source_ref: `https://nvd.nist.gov/vuln/detail/${vuln.cveID}`,
      source_name: 'CISA KEV',
      affected_platforms: JSON.stringify(this.extractPlatforms(vuln)),
      affected_products: JSON.stringify([vuln.product ?? '']),
      ttps: '[]',
      iocs: null,
      is_corroborated: 1,
      ingested_at: new Date().toISOString(),
      processed: 0,
      external_id: vuln.cveID,
      external_source: this.connectorId,
    };
  }

  private extractPlatforms(vuln: any): string[] {
    const platforms: string[] = [];
    const vendor = (vuln.vendorProject ?? '').toLowerCase();
    const product = (vuln.product ?? '').toLowerCase();

    const keywords: Array<[string, string]> = [
      ['microsoft', 'windows'], ['linux', 'linux'], ['apple', 'apple'],
      ['cisco', 'cisco'], ['vmware', 'vmware'], ['broadcom', 'vmware'],
    ];
    for (const [kw, label] of keywords) {
      if (vendor.includes(kw) || product.includes(kw)) platforms.push(label);
    }
    if (platforms.length === 0 && vendor) platforms.push(vendor);
    return platforms;
  }
}
