import type Database from 'better-sqlite3';
import type { Connector } from '../../models/connector.js';
import { BaseAdapter } from './base-adapter.js';
import { CISAKEVAdapter } from './adapters/cisa-kev.js';
import { NVDAdapter } from './adapters/nvd.js';
import { CrowdStrikeAdapter } from './adapters/crowdstrike.js';
import { ServiceNowAdapter } from './adapters/servicenow.js';
import { JiraAdapter } from './adapters/jira.js';
import { SplunkAdapter } from './adapters/splunk.js';
import { OktaAdapter } from './adapters/okta.js';
import { AzureAdAdapter } from './adapters/azure-ad.js';
import { AwsSecurityHubAdapter } from './adapters/aws-security-hub.js';
import { GcpSccAdapter } from './adapters/gcp-scc.js';

type AdapterConstructor = new (
  db: Database.Database,
  connectorId: string,
  config: Record<string, any>,
) => BaseAdapter;

/**
 * Registry of available connector adapters.
 * Maps adapter_class strings to their constructors.
 */
export class AdapterRegistry {
  private adapters = new Map<string, AdapterConstructor>();

  constructor() {
    // Register built-in adapters
    this.register('CISAKEVAdapter', CISAKEVAdapter);
    this.register('NVDAdapter', NVDAdapter);
    this.register('CrowdStrikeAdapter', CrowdStrikeAdapter);
    this.register('ServiceNowAdapter', ServiceNowAdapter);
    this.register('JiraAdapter', JiraAdapter);
    this.register('SplunkAdapter', SplunkAdapter);
    this.register('OktaAdapter', OktaAdapter);
    this.register('AzureAdAdapter', AzureAdAdapter);
    this.register('AwsSecurityHubAdapter', AwsSecurityHubAdapter);
    this.register('GcpSccAdapter', GcpSccAdapter);
  }

  register(name: string, adapterClass: AdapterConstructor): void {
    this.adapters.set(name, adapterClass);
  }

  create(db: Database.Database, connector: Connector): BaseAdapter {
    const Ctor = this.adapters.get(connector.adapter_class);
    if (!Ctor) throw new Error(`Unknown adapter: ${connector.adapter_class}`);
    const config = connector.config ? JSON.parse(connector.config) : {};
    return new Ctor(db, connector.id, config);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
