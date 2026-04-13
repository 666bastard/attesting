import type Database from 'better-sqlite3';
import type { SyncStats } from '../../models/connector.js';
import { generateUuid } from '../../utils/uuid.js';
import { DEFAULT_TIMEOUT_MS } from './utils/fetch-with-timeout.js';

/**
 * Abstract base class for all external system connectors.
 * Subclasses implement fetch() and transform().
 * Bidirectional adapters also implement push().
 */
export abstract class BaseAdapter {
  protected db: Database.Database;
  protected connectorId: string;
  protected config: Record<string, any>;
  protected syncLogId: string | null = null;
  protected stats: SyncStats = { processed: 0, created: 0, updated: 0, deleted: 0, errors: 0 };
  protected errors: Array<{ record_id: string; error: string }> = [];

  constructor(db: Database.Database, connectorId: string, config: Record<string, any> = {}) {
    this.db = db;
    this.connectorId = connectorId;
    this.config = config;
  }

  /**
   * Phase 5H — timeout resolution used by all adapter fetch calls.
   * Config override: `timeout_ms` (number). Defaults to 30s.
   * Subclasses should pass `this.timeoutMs()` into fetchWithTimeout.
   */
  protected timeoutMs(): number {
    const n = Number(this.config.timeout_ms);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
  }

  /** Fetch records from the external system. */
  abstract fetch(since: string | null): Promise<any[]>;

  /** Transform an external record into a Attesting entity shape. */
  abstract transform(record: any): { _table: string; external_id: string; [k: string]: any } | null;

  /** Push a Attesting entity to the external system (bidirectional only). */
  async push(_entity: any): Promise<any> {
    throw new Error('push() not implemented — this may be an inbound-only adapter');
  }

  /** Run a full sync cycle. */
  async sync(syncType: 'full' | 'incremental' = 'incremental'): Promise<SyncStats> {
    this.resetStats();
    this.startSyncLog(syncType);

    try {
      const since = syncType === 'full' ? null : this.getLastSyncTime();
      const records = await this.fetch(since);

      for (const record of records) {
        try {
          const entity = this.transform(record);
          if (entity) {
            this.upsert(entity);
            this.stats.processed++;
          }
        } catch (err: any) {
          this.stats.errors++;
          this.errors.push({ record_id: record.id ?? 'unknown', error: err.message });
        }
      }

      this.completeSyncLog('success');
      this.updateHealth('healthy');
    } catch (err: any) {
      this.completeSyncLog('failed', err.message);
      this.updateHealth('unhealthy');
      throw err;
    }

    return this.stats;
  }

  /** Quick connectivity check. */
  async healthcheck(): Promise<{ status: string; error?: string }> {
    try {
      await this.fetch(new Date().toISOString());
      this.updateHealth('healthy');
      return { status: 'healthy' };
    } catch (err: any) {
      this.updateHealth('unhealthy');
      return { status: 'unhealthy', error: err.message };
    }
  }

  // ── Internal infrastructure ────────────────────────────────

  protected upsert(entity: { _table: string; external_id: string; [k: string]: any }): void {
    const table = entity._table;
    const existing = this.db.prepare(
      `SELECT id FROM ${table} WHERE external_source = ? AND external_id = ?`
    ).get(this.connectorId, entity.external_id) as { id: string } | undefined;

    const fields = Object.keys(entity).filter(k => !k.startsWith('_'));

    if (existing) {
      const sets = fields.filter(k => k !== 'id' && k !== 'external_id')
        .map(k => `${k} = ?`);
      const vals = fields.filter(k => k !== 'id' && k !== 'external_id')
        .map(k => entity[k]);
      sets.push('updated_at = datetime(\'now\')');
      this.db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, existing.id);
      this.stats.updated++;
    } else {
      const id = entity.id ?? generateUuid();
      const cols = fields.map(k => k === 'id' ? 'id' : k);
      const vals = fields.map(k => k === 'id' ? id : entity[k]);
      const placeholders = cols.map(() => '?').join(', ');
      this.db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
      this.stats.created++;
    }
  }

  private resetStats(): void {
    this.stats = { processed: 0, created: 0, updated: 0, deleted: 0, errors: 0 };
    this.errors = [];
  }

  private startSyncLog(syncType: string): void {
    this.syncLogId = generateUuid();
    this.db.prepare(
      `INSERT INTO connector_sync_log (id, connector_id, sync_type, trigger) VALUES (?, ?, ?, 'scheduled')`
    ).run(this.syncLogId, this.connectorId, syncType);
  }

  private completeSyncLog(status: string, errorMsg?: string): void {
    this.db.prepare(`
      UPDATE connector_sync_log
      SET completed_at = datetime('now'), status = ?,
          records_processed = ?, records_created = ?,
          records_updated = ?, records_deleted = ?,
          errors = ?, error_details = ?
      WHERE id = ?
    `).run(
      this.stats.errors > 0 && status === 'success' ? 'partial' : status,
      this.stats.processed, this.stats.created, this.stats.updated, this.stats.deleted,
      this.stats.errors, this.errors.length > 0 ? JSON.stringify(this.errors) : errorMsg ?? null,
      this.syncLogId,
    );

    this.db.prepare(`
      UPDATE connectors
      SET last_sync_at = datetime('now'), last_sync_status = ?,
          last_sync_error = ?, last_sync_stats = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, errorMsg ?? null, JSON.stringify(this.stats), this.connectorId);
  }

  private updateHealth(status: string): void {
    this.db.prepare(
      `UPDATE connectors SET health_status = ?, health_checked_at = datetime('now') WHERE id = ?`
    ).run(status, this.connectorId);
  }

  private getLastSyncTime(): string | null {
    const r = this.db.prepare('SELECT last_sync_at FROM connectors WHERE id = ?')
      .get(this.connectorId) as { last_sync_at: string | null } | undefined;
    return r?.last_sync_at ?? null;
  }
}
