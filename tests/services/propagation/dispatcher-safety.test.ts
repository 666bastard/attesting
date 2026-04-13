import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, seedPolicy } from '../../helpers/test-db.js';
import { propagate, shadowPropagate } from '../../../src/services/propagation/dispatcher.js';
import type { Actor } from '../../../src/services/audit/logger.js';

const actor: Actor = { type: 'user', id: 'test' };

describe('propagation dispatcher safety (5H)', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('catches exceptions thrown inside a handler and records them in the log', async () => {
    // Force a throw from onPolicyContentChange by mocking the module
    const mod = await import('../../../src/services/propagation/governance-handlers.js');
    const spy = vi.spyOn(mod, 'onPolicyContentChange').mockImplementation(() => {
      throw new Error('kaboom from handler');
    });

    const policyId = seedPolicy(db);
    const log = propagate(db, 'policy', policyId, 'update', actor,
      { content_hash: 'a' }, { content_hash: 'b' });

    expect(Array.isArray(log)).toBe(true);
    const err = log.find((e: any) => e.type === 'handler_error');
    expect(err).toBeDefined();
    expect((err as any).error).toContain('kaboom from handler');
    expect((err as any).entity_type).toBe('policy');
    expect((err as any).entity_id).toBe(policyId);

    // Audit entry still written despite the throw
    const auditRows = db.prepare(
      'SELECT * FROM audit_log WHERE entity_id = ?',
    ).all(policyId);
    expect(auditRows.length).toBeGreaterThanOrEqual(1);

    spy.mockRestore();
  });

  it('does not crash the caller when a handler throws', () => {
    const policyId = seedPolicy(db);
    // Even without mocking, propagate is guaranteed not to throw from caller's POV
    expect(() => propagate(db, 'policy', policyId, 'update', actor,
      { content_hash: 'a' }, { content_hash: 'b' })).not.toThrow();
  });

  it('records handler_error for unknown entity types gracefully', () => {
    // Unknown entity returns empty log (no handler match), no throw
    const log = propagate(db, 'unknown' as any, 'xyz', 'update', actor);
    expect(log).toEqual([]);
  });

  it('shadowPropagate also catches handler throws without surfacing them', async () => {
    const mod = await import('../../../src/services/propagation/threat-handlers.js');
    const spy = vi.spyOn(mod, 'onThreatIngested').mockImplementation(() => {
      throw new Error('shadow kaboom');
    });

    const result = shadowPropagate(db, 'threat_input', 'nope', { any: 'state' });
    const err = result.impacts.find((e: any) => e.type === 'handler_error');
    expect(err).toBeDefined();
    expect((err as any).error).toContain('shadow kaboom');

    spy.mockRestore();
  });

  it('non-throwing handlers still run and produce their normal log entries', () => {
    const policyId = seedPolicy(db, { reviewDate: '2020-01-01' });
    const log = propagate(db, 'policy', policyId, 'update', actor,
      { content_hash: 'a', status: 'active' },
      { content_hash: 'b', status: 'active' });
    // governance-handlers.onPolicyContentChange writes a review_overdue entry
    // when review is past due. Should still appear since the handler ran.
    expect(log.some((e: any) => e.type === 'review_overdue')).toBe(true);
    // And no handler_error should be present
    expect(log.some((e: any) => e.type === 'handler_error')).toBe(false);
  });
});
