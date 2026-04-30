/**
 * CLI tests for the `attesting drift` command group.
 *
 * Drives the actual Commander surface end-to-end against an in-memory test
 * DB. Same shape as risk.test.ts and intel.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import type Database from 'better-sqlite3';
import {
  createTestDb,
  seedDriftAlert,
  seedOwner,
} from '../helpers/test-db.js';
import { generateUuid } from '../../src/utils/uuid.js';
import { registerDriftCommands } from '../../src/commands/drift/index.js';
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
  registerDriftCommands(program);
  return program;
}

async function runDrift(...args: string[]): Promise<string> {
  logSpy.mockClear();
  await makeProgram().parseAsync(['node', 'attesting', 'drift', ...args]);
  const lines = logSpy.mock.calls.map((c) => String(c[0] ?? ''));
  const json = lines.find((l) => l.startsWith('{') || l.startsWith('['));
  return json ?? lines.join('\n');
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
// drift list
// ──────────────────────────────────────────────────────────────────────

describe('drift list', () => {
  it('returns empty array when no alerts exist', async () => {
    const out = await runDrift('list', '--json');
    expect(out).toBe('[]');
  });

  it('shows only active alerts by default (excludes resolved + suppressed)', async () => {
    const activeId = seedDriftAlert(testDb, { severity: 'high' });
    const resolvedId = seedDriftAlert(testDb, { severity: 'medium' });
    const suppressedId = seedDriftAlert(testDb, { severity: 'low' });

    testDb.prepare("UPDATE drift_alerts SET resolved_at = datetime('now') WHERE id = ?").run(resolvedId);
    testDb.prepare("UPDATE drift_alerts SET suppressed_until = datetime('now', '+1 day') WHERE id = ?").run(suppressedId);

    const out = await runDrift('list', '--json');
    const parsed = JSON.parse(out) as Array<{ id: string }>;
    expect(parsed.map((a) => a.id)).toEqual([activeId]);
  });

  it('--status all returns every alert regardless of state', async () => {
    seedDriftAlert(testDb, { severity: 'high' });
    const resolvedId = seedDriftAlert(testDb);
    testDb.prepare("UPDATE drift_alerts SET resolved_at = datetime('now') WHERE id = ?").run(resolvedId);

    const out = await runDrift('list', '--status', 'all', '--json');
    const parsed = JSON.parse(out) as any[];
    expect(parsed).toHaveLength(2);
  });

  it('orders critical above high above medium above low', async () => {
    seedDriftAlert(testDb, { severity: 'low' });
    seedDriftAlert(testDb, { severity: 'critical' });
    seedDriftAlert(testDb, { severity: 'medium' });
    seedDriftAlert(testDb, { severity: 'high' });

    const out = await runDrift('list', '--json');
    const parsed = JSON.parse(out) as Array<{ severity: string }>;
    expect(parsed.map((a) => a.severity)).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('--severity filter narrows the result set', async () => {
    seedDriftAlert(testDb, { severity: 'high' });
    seedDriftAlert(testDb, { severity: 'low' });

    const out = await runDrift('list', '--severity', 'high', '--json');
    const parsed = JSON.parse(out) as Array<{ severity: string }>;
    expect(parsed.map((a) => a.severity)).toEqual(['high']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// drift check
// ──────────────────────────────────────────────────────────────────────

describe('drift check', () => {
  it('runs all checks and returns a result map keyed by check name', async () => {
    const out = await runDrift('check', '--json');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    // The scheduler exposes 8 named checks; expect each to have a result key
    const names = Object.keys(parsed);
    expect(names).toContain('evidence_staleness');
    expect(names).toContain('policy_reviews');
    expect(names).toContain('risk_exceptions');
    expect(names).toContain('disposition_expiry');
    expect(names).toContain('manual_intel_expiry');
    expect(names).toContain('posture_recalc');
  });

  it('runs a single named check when given an argument', async () => {
    const out = await runDrift('check', 'risk_exceptions', '--json');
    const parsed = JSON.parse(out) as { check: string; result: unknown };
    expect(parsed.check).toBe('risk_exceptions');
    expect(parsed.result).toBeDefined();
  });

  it('exits with an error for an unknown check name', async () => {
    await expect(runDrift('check', 'imaginary_check')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/unknown check/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// drift dispose
// ──────────────────────────────────────────────────────────────────────

describe('drift dispose', () => {
  it('classifies, commits, and creates a disposition row when --commit is set', async () => {
    const alertId = seedDriftAlert(testDb, { severity: 'medium' });
    const analystId = seedOwner(testDb, { name: 'Analyst One' });

    await runDrift('dispose', alertId,
      '--text', 'accept this risk for now, business priority',
      '--analyst', analystId,
      '--commit', '--json');

    const dispositions = testDb.prepare('SELECT * FROM dispositions WHERE drift_alert_id = ?').all(alertId) as Array<{
      id: string; disposition_type: string; analyst_id: string;
    }>;
    expect(dispositions).toHaveLength(1);
    expect(dispositions[0].analyst_id).toBe(analystId);
    expect(dispositions[0].disposition_type).toBeTypeOf('string');
  });

  it('exits when the alert id does not exist', async () => {
    const analystId = seedOwner(testDb);
    await expect(runDrift('dispose', 'no-such-alert',
      '--text', 't', '--analyst', analystId, '--commit'))
      .rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/not found/i);
  });

  it('returns the parsed disposition without committing when --commit is omitted', async () => {
    const alertId = seedDriftAlert(testDb);
    const analystId = seedOwner(testDb);

    await runDrift('dispose', alertId,
      '--text', 'fix in next sprint',
      '--analyst', analystId, '--json');

    // Without --commit, NLP runs and the disposition object is returned, but
    // no row is inserted into the dispositions table.
    const count = (testDb.prepare('SELECT COUNT(*) AS c FROM dispositions').get() as { c: number }).c;
    expect(count).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// drift tasks
// ──────────────────────────────────────────────────────────────────────

describe('drift tasks', () => {
  it('returns empty array when no tasks exist', async () => {
    const out = await runDrift('tasks', '--json');
    expect(out).toBe('[]');
  });

  it('lists open tasks by default and filters by --status', async () => {
    const alertId = seedDriftAlert(testDb);
    const analystId = seedOwner(testDb);
    const dispId = generateUuid();
    testDb.prepare(`
      INSERT INTO dispositions (id, drift_alert_id, disposition_type, analyst_id,
        rationale, requires_approval, approval_status, expires_at, nlp_confidence,
        created_at)
      VALUES (?, ?, 'accepted_risk', ?, 'r', 0, 'approved',
              datetime('now', '+30 days'), 0.9, datetime('now'))
    `).run(dispId, alertId, analystId);

    testDb.prepare(`
      INSERT INTO disposition_tasks (id, disposition_id, title, status, created_at)
      VALUES (?, ?, 'Open task', 'open', datetime('now')),
             (?, ?, 'Done task', 'completed', datetime('now'))
    `).run(generateUuid(), dispId, generateUuid(), dispId);

    // Default = open only
    const openOut = await runDrift('tasks', '--json');
    const openParsed = JSON.parse(openOut) as Array<{ title: string }>;
    expect(openParsed.map((t) => t.title)).toEqual(['Open task']);

    // --status all returns both
    const allOut = await runDrift('tasks', '--status', 'all', '--json');
    const allParsed = JSON.parse(allOut) as Array<{ title: string }>;
    expect(allParsed.map((t) => t.title).sort()).toEqual(['Done task', 'Open task']);
  });

  it('joins alert + disposition fields into the task row', async () => {
    const alertId = seedDriftAlert(testDb, { severity: 'high' });
    const analystId = seedOwner(testDb);
    const dispId = generateUuid();
    testDb.prepare(`
      INSERT INTO dispositions (id, drift_alert_id, disposition_type, analyst_id,
        rationale, requires_approval, approval_status, expires_at, nlp_confidence,
        created_at)
      VALUES (?, ?, 'deferred', ?, 'r', 0, 'approved',
              datetime('now', '+30 days'), 0.9, datetime('now'))
    `).run(dispId, alertId, analystId);
    testDb.prepare(`
      INSERT INTO disposition_tasks (id, disposition_id, title, status, created_at)
      VALUES (?, ?, 'Inspect logs', 'open', datetime('now'))
    `).run(generateUuid(), dispId);

    const out = await runDrift('tasks', '--json');
    const parsed = JSON.parse(out) as Array<{ disposition_type: string; alert_severity: string; title: string }>;
    expect(parsed[0].disposition_type).toBe('deferred');
    expect(parsed[0].alert_severity).toBe('high');
    expect(parsed[0].title).toBe('Inspect logs');
  });
});

// ──────────────────────────────────────────────────────────────────────
// drift schedule
// ──────────────────────────────────────────────────────────────────────

describe('drift schedule', () => {
  it('lists every check the scheduler exposes with an interval', async () => {
    const out = await runDrift('schedule', '--json');
    const parsed = JSON.parse(out) as Array<{ check: string; interval_minutes: number; interval_human: string }>;
    expect(parsed.length).toBeGreaterThanOrEqual(6);
    const names = parsed.map((s) => s.check);
    expect(names).toContain('evidence_staleness');
    expect(names).toContain('posture_recalc');
    for (const s of parsed) {
      expect(s.interval_minutes).toBeGreaterThan(0);
      expect(s.interval_human).toMatch(/^\d+(\.\d+)?[mhd]$/);
    }
  });

  it('formats intervals: minutes <60, hours <1440, days otherwise', async () => {
    const out = await runDrift('schedule', '--json');
    const parsed = JSON.parse(out) as Array<{ check: string; interval_minutes: number; interval_human: string }>;
    const evidence = parsed.find((s) => s.check === 'evidence_staleness');
    const policy = parsed.find((s) => s.check === 'policy_reviews');
    const posture = parsed.find((s) => s.check === 'posture_recalc');
    expect(evidence?.interval_human).toMatch(/m$/);
    expect(policy?.interval_human).toMatch(/h$/);
    expect(posture?.interval_human).toMatch(/d$/);
  });
});
