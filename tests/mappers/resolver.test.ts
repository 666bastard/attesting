/**
 * Tests for the cross-framework control mapping resolver.
 *
 * Uses a fully in-memory SQLite database so it never touches ~/.attesting/attesting.db.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { resolveControl } from '../../src/mappers/resolver.js';
import { generateUuid } from '../../src/utils/uuid.js';

const SCHEMA_PATH = path.join(__dirname, '../../src/db/schema.sql');

// ---------------------------------------------------------------------------
// DB bootstrapping helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  return db;
}

interface SeedResult {
  /** UUIDs of all 6 controls: [A1, A2, B1, B2, C1, C2] */
  controls: string[];
}

/**
 * Seeds three catalogs (A, B, C) with 2 controls each.
 * Creates mappings:
 *   A.ctrl1 (equivalent) -> B.ctrl1 (high)
 *   B.ctrl1 (equivalent) -> C.ctrl1 (high)
 *
 * This lets us test:
 *   - Direct:      A.ctrl1 -> B.ctrl1
 *   - Bidirection: B.ctrl1 -> A.ctrl1 AND C.ctrl1
 *   - Transitive:  A.ctrl1 depth=2 -> C.ctrl1
 */
function seedDb(db: Database.Database): SeedResult {
  const now = () => new Date().toISOString();

  const catA = generateUuid();
  const catB = generateUuid();
  const catC = generateUuid();

  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at) VALUES (?, ?, ?, 'csv', ?, ?)`
  ).run(catA, 'Catalog A', 'cat-a', now(), now());
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at) VALUES (?, ?, ?, 'csv', ?, ?)`
  ).run(catB, 'Catalog B', 'cat-b', now(), now());
  db.prepare(
    `INSERT INTO catalogs (id, name, short_name, source_format, created_at, updated_at) VALUES (?, ?, ?, 'csv', ?, ?)`
  ).run(catC, 'Catalog C', 'cat-c', now(), now());

  const insertControl = db.prepare(
    `INSERT INTO controls (id, catalog_id, control_id, title, metadata, sort_order, created_at)
     VALUES (?, ?, ?, ?, '{}', 0, ?)`
  );

  const a1 = generateUuid(); insertControl.run(a1, catA, 'A.ctrl1', 'Catalog A Control 1', now());
  const a2 = generateUuid(); insertControl.run(a2, catA, 'A.ctrl2', 'Catalog A Control 2', now());
  const b1 = generateUuid(); insertControl.run(b1, catB, 'B.ctrl1', 'Catalog B Control 1', now());
  const b2 = generateUuid(); insertControl.run(b2, catB, 'B.ctrl2', 'Catalog B Control 2', now());
  const c1 = generateUuid(); insertControl.run(c1, catC, 'C.ctrl1', 'Catalog C Control 1', now());
  const c2 = generateUuid(); insertControl.run(c2, catC, 'C.ctrl2', 'Catalog C Control 2', now());

  const insertMapping = db.prepare(
    `INSERT INTO control_mappings (id, source_control_id, target_control_id, relationship, confidence, source, created_at)
     VALUES (?, ?, ?, 'equivalent', 'high', 'manual', ?)`
  );

  // A.ctrl1 -> B.ctrl1
  insertMapping.run(generateUuid(), a1, b1, now());
  // B.ctrl1 -> C.ctrl1
  insertMapping.run(generateUuid(), b1, c1, now());

  return { controls: [a1, a2, b1, b2, c1, c2] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveControl', () => {
  let db: Database.Database;
  let controls: string[];

  beforeEach(() => {
    db = createTestDb();
    const seed = seedDb(db);
    controls = seed.controls;
  });

  const [a1, , b1, , c1] = (() => {
    // Placeholder — real values set in beforeEach; this is just for naming
    return ['', '', '', '', ''];
  })();
  void a1; void b1; void c1; // suppress unused warnings

  it('direct mapping: resolving A.ctrl1 finds B.ctrl1', () => {
    const [a1uuid] = controls;
    const results = resolveControl(a1uuid, db, 1);

    expect(results).toHaveLength(1);
    expect(results[0].controlNativeId).toBe('B.ctrl1');
    expect(results[0].catalogShortName).toBe('cat-b');
    expect(results[0].isTransitive).toBe(false);
  });

  it('bidirectional: resolving B.ctrl1 finds both A.ctrl1 and C.ctrl1', () => {
    const [, , b1uuid] = controls;
    const results = resolveControl(b1uuid, db, 1);

    const ids = results.map((r) => r.controlNativeId);
    expect(ids).toContain('A.ctrl1');
    expect(ids).toContain('C.ctrl1');
    expect(results).toHaveLength(2);
    // All direct
    expect(results.every((r) => !r.isTransitive)).toBe(true);
  });

  it('transitive: resolving A.ctrl1 at depth 2 finds C.ctrl1', () => {
    const [a1uuid] = controls;
    const results = resolveControl(a1uuid, db, 2);

    const c1Result = results.find((r) => r.controlNativeId === 'C.ctrl1');
    expect(c1Result).toBeDefined();
    expect(c1Result!.isTransitive).toBe(true);
  });

  it('confidence degrades on transitive hop: high -> medium', () => {
    const [a1uuid] = controls;
    const results = resolveControl(a1uuid, db, 2);

    const c1Result = results.find((r) => r.controlNativeId === 'C.ctrl1');
    expect(c1Result).toBeDefined();
    // Direct mapping A->B is high; transitive A->B->C should degrade to medium
    expect(c1Result!.confidence).toBe('medium');
  });

  it('direct mapping has high confidence (unchanged)', () => {
    const [a1uuid] = controls;
    const results = resolveControl(a1uuid, db, 1);

    const b1Result = results.find((r) => r.controlNativeId === 'B.ctrl1');
    expect(b1Result!.confidence).toBe('high');
  });

  it('depth=1 limits to direct mappings only (no transitive)', () => {
    const [a1uuid] = controls;
    const results = resolveControl(a1uuid, db, 1);

    const transitive = results.filter((r) => r.isTransitive);
    expect(transitive).toHaveLength(0);
  });

  it('controls with no mappings return empty array', () => {
    const [, a2uuid] = controls;
    const results = resolveControl(a2uuid, db, 2);
    expect(results).toHaveLength(0);
  });

  it('transitive path includes intermediate node UUID', () => {
    const [a1uuid, , b1uuid] = controls;
    const results = resolveControl(a1uuid, db, 2);

    const c1Result = results.find((r) => r.controlNativeId === 'C.ctrl1');
    expect(c1Result!.path).toContain(b1uuid);
  });
});
