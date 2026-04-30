/**
 * CLI tests for the `attesting connector` command group.
 *
 * Drives the actual Commander surface end-to-end against an in-memory test
 * DB. Adapter behavior (sync, healthcheck) is stubbed via a spy on
 * AdapterRegistry.prototype.create so tests never touch the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import type Database from 'better-sqlite3';
import { createTestDb, seedConnector } from '../helpers/test-db.js';
import { generateUuid } from '../../src/utils/uuid.js';
import { registerConnectorCommands } from '../../src/commands/connector/index.js';
import { AdapterRegistry } from '../../src/services/connectors/registry.js';
import * as connection from '../../src/db/connection.js';

let testDb: Database.Database;
let originalGetDb: () => Database.Database;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

class ProcessExit extends Error {
  constructor(public code: number) { super(`process.exit(${code})`); }
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerConnectorCommands(program);
  return program;
}

async function runConnector(...args: string[]): Promise<string> {
  logSpy.mockClear();
  await makeProgram().parseAsync(['node', 'attesting', 'connector', ...args]);
  const lines = logSpy.mock.calls.map((c) => String(c[0] ?? ''));
  const json = lines.find((l) => l.startsWith('{') || l.startsWith('['));
  return json ?? lines.join('\n');
}

/** Fake adapter: returns canned sync stats and healthcheck results. */
function stubAdapter(opts: {
  sync?: () => Promise<unknown>;
  healthcheck?: () => Promise<unknown>;
} = {}): any {
  return {
    sync: opts.sync ?? (async () => ({ created: 5, updated: 0, deleted: 0, errors: 0 })),
    healthcheck: opts.healthcheck ?? (async () => ({ status: 'healthy' })),
  };
}

beforeEach(() => {
  testDb = createTestDb();
  originalGetDb = connection.db.getDb.bind(connection.db);
  connection.db.getDb = () => testDb;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExit(code ?? 0);
  }) as never);
});

afterEach(() => {
  connection.db.getDb = originalGetDb;
  testDb.close();
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// connector list
// ──────────────────────────────────────────────────────────────────────

describe('connector list', () => {
  it('returns empty array when no connectors are registered', async () => {
    const out = await runConnector('list', '--json');
    expect(out).toBe('[]');
  });

  it('lists registered connectors with last_sync metadata joined in', async () => {
    const id = seedConnector(testDb, { adapterClass: 'CISAKEVAdapter' });

    testDb.prepare(`
      INSERT INTO connector_sync_log (id, connector_id, started_at, status, records_processed, sync_type)
      VALUES (?, ?, datetime('now', '-1 hour'), 'success', 42, 'full')
    `).run(generateUuid(), id);

    const out = await runConnector('list', '--json');
    const parsed = JSON.parse(out) as Array<{
      id: string; adapter_class: string; last_sync: string; last_sync_status: string; last_records: number;
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(id);
    expect(parsed[0].adapter_class).toBe('CISAKEVAdapter');
    expect(parsed[0].last_sync).toBeTruthy();
    expect(parsed[0].last_sync_status).toBe('success');
    expect(parsed[0].last_records).toBe(42);
  });
});

// ──────────────────────────────────────────────────────────────────────
// connector add
// ──────────────────────────────────────────────────────────────────────

describe('connector add', () => {
  it('inserts a connector row when --type matches a registered adapter', async () => {
    await runConnector('add',
      '--name', 'My CISA Feed',
      '--type', 'CISAKEVAdapter',
      '--connector-type', 'threat_feed',
      '--direction', 'inbound',
      '--json');

    const rows = testDb.prepare('SELECT * FROM connectors').all() as Array<{
      name: string; adapter_class: string; connector_type: string; direction: string;
      sync_mode: string; is_enabled: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('My CISA Feed');
    expect(rows[0].adapter_class).toBe('CISAKEVAdapter');
    expect(rows[0].connector_type).toBe('threat_feed');
    expect(rows[0].direction).toBe('inbound');
    expect(rows[0].sync_mode).toBe('manual');
    expect(rows[0].is_enabled).toBe(1);
  });

  it('persists --config when it parses as JSON', async () => {
    await runConnector('add',
      '--name', 'Splunk',
      '--type', 'SplunkAdapter',
      '--config', '{"host":"splunk.example.com","token":"x"}',
      '--json');

    const row = testDb.prepare('SELECT config FROM connectors').get() as { config: string };
    expect(JSON.parse(row.config)).toEqual({ host: 'splunk.example.com', token: 'x' });
  });

  it('rejects an unknown adapter class', async () => {
    await expect(runConnector('add',
      '--name', 'x', '--type', 'NotAnAdapter')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/unknown adapter/i);
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM connectors').get()).toEqual({ c: 0 });
  });

  it('rejects malformed --config JSON', async () => {
    await expect(runConnector('add',
      '--name', 'x', '--type', 'CISAKEVAdapter',
      '--config', '{not json}')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/invalid config/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// connector sync
// ──────────────────────────────────────────────────────────────────────

describe('connector sync', () => {
  it('calls adapter.sync and reports per-connector stats', async () => {
    const createSpy = vi.spyOn(AdapterRegistry.prototype, 'create').mockReturnValue(
      stubAdapter({ sync: async () => ({ created: 7, updated: 1, errors: 0 }) }),
    );
    const id = seedConnector(testDb, { adapterClass: 'CISAKEVAdapter' });

    const out = await runConnector('sync', id, '--json');
    const parsed = JSON.parse(out) as Array<{ id: string; status: string; stats: { created: number } }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(id);
    expect(parsed[0].status).toBe('success');
    expect(parsed[0].stats.created).toBe(7);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('reports failure entries when adapter.sync rejects', async () => {
    vi.spyOn(AdapterRegistry.prototype, 'create').mockReturnValue(
      stubAdapter({ sync: async () => { throw new Error('upstream 503'); } }),
    );
    const id = seedConnector(testDb);

    const out = await runConnector('sync', id, '--json');
    const parsed = JSON.parse(out) as Array<{ status: string; error: string }>;
    expect(parsed[0].status).toBe('failed');
    expect(parsed[0].error).toBe('upstream 503');
  });

  it('exits when the connector id does not exist', async () => {
    await expect(runConnector('sync', 'no-such-conn')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/not found/i);
  });

  it('syncs all enabled connectors when no id is given', async () => {
    vi.spyOn(AdapterRegistry.prototype, 'create').mockReturnValue(stubAdapter());
    const id1 = seedConnector(testDb);
    const id2 = seedConnector(testDb);

    const out = await runConnector('sync', '--json');
    const parsed = JSON.parse(out) as Array<{ id: string; status: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((r) => r.id).sort()).toEqual([id1, id2].sort());
  });

  it('exits when there are no enabled connectors and no id given', async () => {
    await expect(runConnector('sync')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/no enabled/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// connector log
// ──────────────────────────────────────────────────────────────────────

describe('connector log', () => {
  it('returns empty array with no log entries', async () => {
    const out = await runConnector('log', '--json');
    expect(out).toBe('[]');
  });

  it('orders entries DESC by started_at', async () => {
    const connId = seedConnector(testDb);
    testDb.prepare(`
      INSERT INTO connector_sync_log (id, connector_id, started_at, status, sync_type)
      VALUES (?, ?, datetime('now', '-2 hours'), 'success', 'full'),
             (?, ?, datetime('now', '-1 hour'),  'success', 'incremental'),
             (?, ?, datetime('now'),             'failed',  'incremental')
    `).run(generateUuid(), connId, generateUuid(), connId, generateUuid(), connId);

    const out = await runConnector('log', '--json');
    const parsed = JSON.parse(out) as Array<{ status: string; sync_type: string }>;
    expect(parsed).toHaveLength(3);
    expect(parsed[0].status).toBe('failed');
    expect(parsed[2].status).toBe('success');
  });

  it('--status filter narrows by sync status', async () => {
    const connId = seedConnector(testDb);
    testDb.prepare(`
      INSERT INTO connector_sync_log (id, connector_id, status, sync_type)
      VALUES (?, ?, 'success', 'full'),
             (?, ?, 'failed',  'full'),
             (?, ?, 'success', 'incremental')
    `).run(generateUuid(), connId, generateUuid(), connId, generateUuid(), connId);

    const out = await runConnector('log', '--status', 'failed', '--json');
    const parsed = JSON.parse(out) as Array<{ status: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('failed');
  });

  it('--limit caps how many entries are returned', async () => {
    const connId = seedConnector(testDb);
    for (let i = 0; i < 5; i++) {
      testDb.prepare(`
        INSERT INTO connector_sync_log (id, connector_id, status, sync_type)
        VALUES (?, ?, 'success', 'full')
      `).run(generateUuid(), connId);
    }

    const out = await runConnector('log', '--limit', '2', '--json');
    const parsed = JSON.parse(out) as any[];
    expect(parsed).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────────────
// connector health
// ──────────────────────────────────────────────────────────────────────

describe('connector health', () => {
  it('runs healthcheck and updates connectors.health_status', async () => {
    vi.spyOn(AdapterRegistry.prototype, 'create').mockReturnValue(
      stubAdapter({ healthcheck: async () => ({ status: 'healthy', latency_ms: 12 }) }),
    );
    const id = seedConnector(testDb);

    const out = await runConnector('health', id, '--json');
    const parsed = JSON.parse(out) as Array<{ id: string; status: string; latency_ms: number }>;
    expect(parsed[0].id).toBe(id);
    expect(parsed[0].status).toBe('healthy');
    expect(parsed[0].latency_ms).toBe(12);

    const row = testDb.prepare('SELECT health_status FROM connectors WHERE id = ?').get(id) as { health_status: string };
    expect(row.health_status).toBe('healthy');
  });

  it('writes health_status=error when adapter.healthcheck throws', async () => {
    vi.spyOn(AdapterRegistry.prototype, 'create').mockReturnValue(
      stubAdapter({ healthcheck: async () => { throw new Error('connection refused'); } }),
    );
    const id = seedConnector(testDb);

    const out = await runConnector('health', id, '--json');
    const parsed = JSON.parse(out) as Array<{ status: string; error: string }>;
    expect(parsed[0].status).toBe('error');
    expect(parsed[0].error).toBe('connection refused');

    const row = testDb.prepare('SELECT health_status FROM connectors WHERE id = ?').get(id) as { health_status: string };
    expect(row.health_status).toBe('unhealthy');
  });

  it('exits when the connector id does not exist', async () => {
    await expect(runConnector('health', 'no-such-conn')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/not found/i);
  });

  it('exits when there are no enabled connectors and no id given', async () => {
    await expect(runConnector('health')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/no enabled/i);
  });
});
