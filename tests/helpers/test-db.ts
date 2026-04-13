/**
 * Shared test database helper.
 * Creates an in-memory SQLite database with schema + migrations applied.
 * Provides seed helpers for common test fixtures.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { generateUuid } from '../../src/utils/uuid.js';

const SCHEMA_PATH = path.join(__dirname, '../../src/db/schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

const ts = () => new Date().toISOString();

/** Create a fresh in-memory database with schema + all migrations. */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply base schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  // Apply migrations
  if (fs.existsSync(MIGRATIONS_DIR)) {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      try { db.exec(sql); } catch { /* duplicate column tolerance */ }
    }
  }

  return db;
}

/** Seed an organization + scope. Returns IDs. */
export function seedOrg(db: Database.Database) {
  const orgId = generateUuid();
  db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(orgId, 'Test Org', ts(), ts());

  const scopeId = generateUuid();
  db.prepare('INSERT INTO scopes (id, org_id, name, scope_type, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(scopeId, orgId, 'Production', 'product', ts(), ts());

  return { orgId, scopeId };
}

/** Seed a catalog with N controls. Returns catalog ID + control IDs. */
export function seedCatalog(db: Database.Database, controlCount = 3) {
  const catId = generateUuid();
  db.prepare('INSERT INTO catalogs (id, name, short_name, source_format, total_controls, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(catId, 'Test Framework', 'test-fw', 'csv', controlCount, ts(), ts());

  const controlIds: string[] = [];
  const insert = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, description, metadata, sort_order, created_at) VALUES (?,?,?,?,?,'{}',?,?)`
  );
  for (let i = 1; i <= controlCount; i++) {
    const id = generateUuid();
    insert.run(id, catId, `AC-${i}`, `Access Control ${i}`, `Description ${i}`, i, ts());
    controlIds.push(id);
  }

  return { catId, controlIds };
}

/** Seed an implementation for a control. */
export function seedImplementation(db: Database.Database, orgId: string, controlId: string, status = 'implemented') {
  const id = generateUuid();
  db.prepare(
    'INSERT INTO implementations (id, org_id, primary_control_id, status, statement, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, orgId, controlId, status, 'Test implementation', ts(), ts());
  return id;
}

/** Seed a risk with controls linked. */
export function seedRisk(db: Database.Database, opts: { controlIds?: string[]; likelihood?: number; impact?: number } = {}) {
  const id = generateUuid();
  const likelihood = opts.likelihood ?? 3;
  const impact = opts.impact ?? 4;
  const riskRef = `RISK-${Date.now() % 1000}`;

  db.prepare(`
    INSERT INTO risks (id, risk_id, title, description, likelihood, impact, inherent_risk_score, owner, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, riskRef, 'Test Risk', 'Test risk description', likelihood, impact, likelihood * impact, 'TestOwner', 'open', ts(), ts());

  for (const ctrlId of opts.controlIds ?? []) {
    db.prepare('INSERT INTO risk_controls (id, risk_id, control_id, effectiveness) VALUES (?,?,?,?)')
      .run(generateUuid(), id, ctrlId, 'partial');
  }

  return id;
}

/** Seed a policy. */
export function seedPolicy(db: Database.Database, opts: { reviewDate?: string; status?: string } = {}) {
  const id = generateUuid();
  db.prepare(`
    INSERT INTO policies (id, title, short_name, status, content_hash, review_date, next_review_date, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, 'Test Policy', 'test-policy', opts.status ?? 'active', 'hash123',
    opts.reviewDate ?? null, opts.reviewDate ?? null, ts(), ts());
  return id;
}

/** Seed an asset. */
export function seedAsset(db: Database.Database, opts: { platform?: string; name?: string } = {}) {
  const id = generateUuid();
  db.prepare(`
    INSERT INTO assets (id, name, asset_type, platform, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, opts.name ?? 'Test Server', 'server', opts.platform ?? 'aws', 'active', ts(), ts());
  return id;
}

/** Seed a threat input. */
export function seedThreat(db: Database.Database, opts: {
  severity?: string; platform?: string; cveId?: string; title?: string; ttps?: string;
} = {}) {
  const id = generateUuid();
  db.prepare(`
    INSERT INTO threat_inputs (id, channel, threat_type, title, description, severity,
      cve_id, affected_platforms, ttps, ingested_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
  `).run(id, 'manual', 'vulnerability', opts.title ?? 'Test Threat', 'Test threat desc',
    opts.severity ?? 'high', opts.cveId ?? null,
    JSON.stringify(opts.platform ? [opts.platform] : []),
    opts.ttps ?? '[]');
  return id;
}

/** Seed a drift alert. */
export function seedDriftAlert(db: Database.Database, opts: {
  alertType?: string; severity?: string; sourceType?: string; sourceId?: string;
} = {}) {
  const id = generateUuid();
  db.prepare(`
    INSERT INTO drift_alerts (id, alert_type, severity, title, message, source_entity_type, source_entity_id)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, opts.alertType ?? 'evidence_expired', opts.severity ?? 'medium',
    'Test Alert', 'Test message', opts.sourceType ?? 'evidence', opts.sourceId ?? generateUuid());
  return id;
}

/** Seed a connector. */
export function seedConnector(
  db: Database.Database,
  opts: { adapterClass?: string; config?: Record<string, unknown> } = {},
) {
  const id = generateUuid();
  db.prepare(`
    INSERT INTO connectors (id, name, connector_type, direction, target_module,
      adapter_class, config, is_enabled, health_status, sync_mode, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,1,'unknown','manual',?,?)
  `).run(
    id,
    'Test Connector',
    'threat_feed',
    'inbound',
    'multi',
    opts.adapterClass ?? 'CISAKEVAdapter',
    opts.config ? JSON.stringify(opts.config) : null,
    ts(),
    ts(),
  );
  return id;
}

/** Seed an owner. */
export function seedOwner(db: Database.Database, opts: { name?: string; supervisor?: boolean } = {}) {
  const id = generateUuid();
  db.prepare('INSERT INTO owners (id, name, email, role, is_supervisor, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, opts.name ?? 'Test User', 'test@example.com', 'analyst', opts.supervisor ? 1 : 0, ts());
  return id;
}

/** Seed manual intel entry. */
export function seedManualIntel(db: Database.Database, opts: {
  status?: string; severity?: string; platforms?: string[]; controls?: string[]; title?: string;
} = {}) {
  const id = generateUuid();
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 30);
  db.prepare(`
    INSERT INTO manual_intel (id, title, description, source_description, confidence_level,
      intel_type, severity_estimate, affected_platforms_est, affected_controls_est,
      corroboration_deadline, corroboration_sources, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
  `).run(id, opts.title ?? 'Test Intel', 'Test description', 'source', 'unverified',
    'threat', opts.severity ?? 'medium',
    JSON.stringify(opts.platforms ?? []),
    JSON.stringify(opts.controls ?? []),
    deadline.toISOString(), '[]', opts.status ?? 'provisional');
  return id;
}
