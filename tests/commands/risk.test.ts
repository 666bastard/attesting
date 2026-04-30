/**
 * CLI tests for the `attesting risk` command group.
 *
 * Drives the actual Commander surface: each test parses an argv list,
 * captures console output, and asserts on JSON or DB state. The DB
 * singleton is monkey-patched onto an in-memory database — never touches
 * ~/.attesting/attesting.db.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import type Database from 'better-sqlite3';
import { createTestDb, seedCatalog, seedAsset } from '../helpers/test-db.js';
import { generateUuid } from '../../src/utils/uuid.js';
import { registerRiskCommands } from '../../src/commands/risk/index.js';
import * as connection from '../../src/db/connection.js';

let testDb: Database.Database;
let originalGetDb: () => Database.Database;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

class ProcessExit extends Error {
  constructor(public code: number) { super(`process.exit(${code})`); }
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerRiskCommands(program);
  return program;
}

/**
 * Run `attesting risk …`. The same command can produce both a `success()`
 * line and a JSON body (e.g. `risk matrix --json` on first run). Returns
 * the JSON-shaped console.log call when one exists, else all output joined.
 */
async function runRisk(...args: string[]): Promise<string> {
  logSpy.mockClear();
  await makeProgram().parseAsync(['node', 'attesting', 'risk', ...args]);
  const lines = logSpy.mock.calls.map((c) => String(c[0] ?? ''));
  const json = lines.find((l) => l.startsWith('{') || l.startsWith('['));
  return json ?? lines.join('\n');
}

/** Insert a risk with a specific reference, returning its UUID. */
function insertRisk(
  db: Database.Database,
  ref: string,
  opts: { likelihood?: number; impact?: number; status?: string; owner?: string } = {},
): string {
  const id = generateUuid();
  const l = opts.likelihood ?? 3;
  const i = opts.impact ?? 4;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO risks
       (id, risk_id, title, description, likelihood, impact, inherent_risk_score,
        treatment, owner, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, ref, `Title for ${ref}`, 'desc', l, i, l * i,
    'mitigate', opts.owner ?? 'alice', opts.status ?? 'open', ts, ts,
  );
  return id;
}

beforeEach(() => {
  testDb = createTestDb();
  originalGetDb = connection.db.getDb.bind(connection.db);
  connection.db.getDb = () => testDb;

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExit(code ?? 0);
  }) as never);
});

afterEach(() => {
  connection.db.getDb = originalGetDb;
  testDb.close();
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// risk list
// ──────────────────────────────────────────────────────────────────────

describe('risk list', () => {
  it('returns empty result with a warning when register is empty', async () => {
    await runRisk('list', '--json');
    expect(logSpy).toHaveBeenCalledWith('[]');
  });

  it('lists all risks as JSON sorted by inherent score desc', async () => {
    insertRisk(testDb, 'RISK-001', { likelihood: 2, impact: 2 }); // 4
    insertRisk(testDb, 'RISK-002', { likelihood: 5, impact: 5 }); // 25
    insertRisk(testDb, 'RISK-003', { likelihood: 3, impact: 3 }); // 9

    const out = await runRisk('list', '--json');
    const parsed = JSON.parse(out) as Array<{ risk_id: string; inherent_risk_score: number }>;
    expect(parsed.map((r) => r.risk_id)).toEqual(['RISK-002', 'RISK-003', 'RISK-001']);
  });

  it('--status filter narrows the result set', async () => {
    insertRisk(testDb, 'RISK-001', { status: 'open' });
    insertRisk(testDb, 'RISK-002', { status: 'mitigated' });

    const out = await runRisk('list', '--status', 'mitigated', '--json');
    const parsed = JSON.parse(out) as Array<{ risk_id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].risk_id).toBe('RISK-002');
  });

  it('--severity filter applies the inherent score threshold', async () => {
    insertRisk(testDb, 'RISK-LOW', { likelihood: 1, impact: 2 }); // 2
    insertRisk(testDb, 'RISK-HIGH', { likelihood: 5, impact: 4 }); // 20

    const out = await runRisk('list', '--severity', '10', '--json');
    const parsed = JSON.parse(out) as Array<{ risk_id: string }>;
    expect(parsed.map((r) => r.risk_id)).toEqual(['RISK-HIGH']);
  });

  it('--owner filter is a substring match', async () => {
    insertRisk(testDb, 'RISK-A', { owner: 'alice@example.com' });
    insertRisk(testDb, 'RISK-B', { owner: 'bob@example.com' });

    const out = await runRisk('list', '--owner', 'alice', '--json');
    const parsed = JSON.parse(out) as Array<{ risk_id: string }>;
    expect(parsed.map((r) => r.risk_id)).toEqual(['RISK-A']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// risk create
// ──────────────────────────────────────────────────────────────────────

describe('risk create', () => {
  it('inserts a risk row with computed inherent score and auto-numbered ref', async () => {
    await runRisk('create', '--title', 'New SQL injection risk',
      '--owner', 'sec-team', '--likelihood', '4', '--impact', '5', '--json');

    const rows = testDb.prepare('SELECT * FROM risks').all() as Array<{
      title: string; risk_id: string; likelihood: number; impact: number;
      inherent_risk_score: number; status: string; owner: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].risk_id).toBe('RISK-001');
    expect(rows[0].title).toBe('New SQL injection risk');
    expect(rows[0].likelihood).toBe(4);
    expect(rows[0].impact).toBe(5);
    expect(rows[0].inherent_risk_score).toBe(20);
    expect(rows[0].status).toBe('open');
  });

  it('auto-increments RISK-NNN across creates', async () => {
    await runRisk('create', '--title', 'r1', '--owner', 'o',
      '--likelihood', '1', '--impact', '1');
    await runRisk('create', '--title', 'r2', '--owner', 'o',
      '--likelihood', '2', '--impact', '2');
    await runRisk('create', '--title', 'r3', '--owner', 'o',
      '--likelihood', '3', '--impact', '3');

    const refs = (testDb.prepare('SELECT risk_id FROM risks ORDER BY created_at').all() as Array<{ risk_id: string }>)
      .map((r) => r.risk_id);
    expect(refs).toEqual(['RISK-001', 'RISK-002', 'RISK-003']);
  });

  it('rejects likelihood out of range', async () => {
    await expect(runRisk('create', '--title', 't', '--owner', 'o',
      '--likelihood', '7', '--impact', '3')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/[Ll]ikelihood/);
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM risks').get()).toEqual({ c: 0 });
  });

  it('rejects unknown treatment values', async () => {
    await expect(runRisk('create', '--title', 't', '--owner', 'o',
      '--likelihood', '1', '--impact', '1',
      '--treatment', 'banana')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/treatment/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// risk update
// ──────────────────────────────────────────────────────────────────────

describe('risk update', () => {
  it('updates status and emits propagated row', async () => {
    insertRisk(testDb, 'RISK-001', { status: 'open' });
    await runRisk('update', 'RISK-001', '--status', 'mitigated', '--json');

    const row = testDb.prepare('SELECT status FROM risks WHERE risk_id = ?').get('RISK-001') as { status: string };
    expect(row.status).toBe('mitigated');
  });

  it('recomputes inherent_risk_score when likelihood or impact changes', async () => {
    insertRisk(testDb, 'RISK-001', { likelihood: 2, impact: 2 });
    await runRisk('update', 'RISK-001', '--likelihood', '5');

    const row = testDb.prepare('SELECT likelihood, impact, inherent_risk_score FROM risks WHERE risk_id = ?').get('RISK-001') as {
      likelihood: number; impact: number; inherent_risk_score: number;
    };
    expect(row.likelihood).toBe(5);
    expect(row.impact).toBe(2);
    expect(row.inherent_risk_score).toBe(10);
  });

  it('exits when the risk reference does not exist', async () => {
    await expect(runRisk('update', 'RISK-999', '--status', 'closed')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/not found/i);
  });

  it('exits when no update flags are provided', async () => {
    insertRisk(testDb, 'RISK-001');
    await expect(runRisk('update', 'RISK-001')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/No update flags/i);
  });

  it('accepts UUID lookup as well as risk_id', async () => {
    const uuid = insertRisk(testDb, 'RISK-001', { owner: 'alice' });
    await runRisk('update', uuid, '--owner', 'bob');

    const row = testDb.prepare('SELECT owner FROM risks WHERE id = ?').get(uuid) as { owner: string };
    expect(row.owner).toBe('bob');
  });
});

// ──────────────────────────────────────────────────────────────────────
// risk link
// ──────────────────────────────────────────────────────────────────────

describe('risk link', () => {
  it('links a risk to a control by control_id reference', async () => {
    const { controlIds } = seedCatalog(testDb, 1);
    insertRisk(testDb, 'RISK-001');

    // The CLI accepts native control_id (e.g. "AC-1") OR UUID
    await runRisk('link', 'RISK-001', '--control', 'AC-1', '--effectiveness', 'partial');

    const links = testDb.prepare('SELECT control_id, effectiveness FROM risk_controls').all() as Array<{
      control_id: string; effectiveness: string;
    }>;
    expect(links).toHaveLength(1);
    expect(links[0].control_id).toBe(controlIds[0]);
    expect(links[0].effectiveness).toBe('partial');
  });

  it('updates effectiveness when the link already exists (no duplicate row)', async () => {
    const { controlIds } = seedCatalog(testDb, 1);
    insertRisk(testDb, 'RISK-001');

    await runRisk('link', 'RISK-001', '--control', 'AC-1', '--effectiveness', 'partial');
    await runRisk('link', 'RISK-001', '--control', 'AC-1', '--effectiveness', 'full');

    const links = testDb.prepare('SELECT effectiveness FROM risk_controls').all() as Array<{ effectiveness: string }>;
    expect(links).toHaveLength(1);
    expect(links[0].effectiveness).toBe('full');
  });

  it('--list mode emits both control and asset links as JSON', async () => {
    const { controlIds } = seedCatalog(testDb, 1);
    const assetId = seedAsset(testDb, { name: 'web-app' });
    insertRisk(testDb, 'RISK-001');

    await runRisk('link', 'RISK-001', '--control', 'AC-1');
    await runRisk('link', 'RISK-001', '--asset', 'web-app');

    const out = await runRisk('link', 'RISK-001', '--list', '--json');
    const parsed = JSON.parse(out) as { controlLinks: any[]; assetLinks: any[] };
    expect(parsed.controlLinks).toHaveLength(1);
    expect(parsed.controlLinks[0].ctrl_ref).toBe('AC-1');
    expect(parsed.assetLinks).toHaveLength(1);
    expect(parsed.assetLinks[0].id).toBe(assetId);
  });

  it('rejects unknown effectiveness values', async () => {
    seedCatalog(testDb, 1);
    insertRisk(testDb, 'RISK-001');
    await expect(runRisk('link', 'RISK-001', '--control', 'AC-1',
      '--effectiveness', 'kinda')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/effectiveness/i);
  });

  it('exits when neither --control nor --asset is provided', async () => {
    insertRisk(testDb, 'RISK-001');
    await expect(runRisk('link', 'RISK-001')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/--control|--asset/i);
  });
});

// ──────────────────────────────────────────────────────────────────────
// risk exceptions
// ──────────────────────────────────────────────────────────────────────

describe('risk exceptions', () => {
  it('creates an exception with required fields', async () => {
    insertRisk(testDb, 'RISK-001');
    await runRisk('exceptions', 'RISK-001', '--create',
      '--justification', 'compensating monitoring in place',
      '--approved-by', 'CISO',
      '--expiry-date', '2027-01-01');

    const rows = testDb.prepare('SELECT * FROM risk_exceptions').all() as Array<{
      justification: string; approved_by: string; expiry_date: string; status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].justification).toBe('compensating monitoring in place');
    expect(rows[0].approved_by).toBe('CISO');
    expect(rows[0].expiry_date).toBe('2027-01-01');
    expect(rows[0].status).toBe('active');
  });

  it('rejects --create without --justification', async () => {
    insertRisk(testDb, 'RISK-001');
    await expect(runRisk('exceptions', 'RISK-001', '--create',
      '--approved-by', 'CISO',
      '--expiry-date', '2027-01-01')).rejects.toThrow(ProcessExit);
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/justification/i);
  });

  it('--expire transitions status to expired', async () => {
    const riskUuid = insertRisk(testDb, 'RISK-001');
    const excId = generateUuid();
    testDb.prepare(
      `INSERT INTO risk_exceptions (id, risk_id, justification, approved_by,
        approved_date, expiry_date, status, created_at)
       VALUES (?, ?, 'j', 'a', datetime('now'), '2027-01-01', 'active', datetime('now'))`,
    ).run(excId, riskUuid);

    await runRisk('exceptions', '--expire', excId);
    const row = testDb.prepare('SELECT status FROM risk_exceptions WHERE id = ?').get(excId) as { status: string };
    expect(row.status).toBe('expired');
  });

  it('lists all exceptions when no risk-ref is provided', async () => {
    const r1 = insertRisk(testDb, 'RISK-001');
    const r2 = insertRisk(testDb, 'RISK-002');
    testDb.prepare(
      `INSERT INTO risk_exceptions (id, risk_id, justification, approved_by,
        approved_date, expiry_date, status, created_at)
       VALUES (?, ?, 'j1', 'a', datetime('now'), '2027-01-01', 'active', datetime('now')),
              (?, ?, 'j2', 'a', datetime('now'), '2027-06-01', 'active', datetime('now'))`,
    ).run(generateUuid(), r1, generateUuid(), r2);

    const out = await runRisk('exceptions', '--json');
    const parsed = JSON.parse(out) as Array<{ risk_ref: string }>;
    expect(parsed).toHaveLength(2);
    // Sorted by expiry_date ASC
    expect(parsed[0].risk_ref).toBe('RISK-001');
    expect(parsed[1].risk_ref).toBe('RISK-002');
  });
});

// ──────────────────────────────────────────────────────────────────────
// risk matrix
// ──────────────────────────────────────────────────────────────────────

describe('risk matrix', () => {
  it('creates and returns a default matrix on first run', async () => {
    const out = await runRisk('matrix', '--json');
    const parsed = JSON.parse(out) as { name: string; risk_appetite: string; appetite_threshold: number };
    expect(parsed.name).toBe('Default');
    expect(parsed.risk_appetite).toBe('moderate');
    expect(parsed.appetite_threshold).toBe(9);

    const count = (testDb.prepare('SELECT COUNT(*) AS c FROM risk_matrix').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('--appetite and --threshold update existing matrix', async () => {
    await runRisk('matrix'); // create default first
    await runRisk('matrix', '--appetite', 'high', '--threshold', '15');

    const row = testDb.prepare('SELECT risk_appetite, appetite_threshold FROM risk_matrix LIMIT 1').get() as {
      risk_appetite: string; appetite_threshold: number;
    };
    expect(row.risk_appetite).toBe('high');
    expect(row.appetite_threshold).toBe(15);
  });

  it('rejects an invalid appetite value', async () => {
    await expect(runRisk('matrix', '--appetite', 'blue')).rejects.toThrow(ProcessExit);
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/appetite/i);
  });

  it('--above-appetite filter on risk list uses the threshold', async () => {
    await runRisk('matrix', '--threshold', '10');
    insertRisk(testDb, 'RISK-LOW', { likelihood: 1, impact: 2 });   // 2 — below
    insertRisk(testDb, 'RISK-HIGH', { likelihood: 4, impact: 4 });  // 16 — above

    const out = await runRisk('list', '--above-appetite', '--json');
    const parsed = JSON.parse(out) as Array<{ risk_id: string }>;
    expect(parsed.map((r) => r.risk_id)).toEqual(['RISK-HIGH']);
  });
});
