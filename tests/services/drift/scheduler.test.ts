import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../helpers/test-db.js';
import { DriftScheduler } from '../../../src/services/drift/scheduler.js';
import type Database from 'better-sqlite3';

describe('DriftScheduler', () => {
  let db: Database.Database;
  let scheduler: DriftScheduler;

  beforeEach(() => {
    db = createTestDb();
    scheduler = new DriftScheduler(db);
  });

  afterEach(() => {
    // Ensure scheduler intervals are cleared if start() was called
    scheduler.stop();
  });

  it('listChecks returns 8 check names', () => {
    const checks = scheduler.listChecks();
    expect(checks).toHaveLength(8);
    expect(checks).toContain('evidence_staleness');
    expect(checks).toContain('policy_reviews');
    expect(checks).toContain('risk_exceptions');
    expect(checks).toContain('disposition_expiry');
    expect(checks).toContain('manual_intel_expiry');
    expect(checks).toContain('posture_recalc');
    expect(checks).toContain('posture_monitor');
    expect(checks).toContain('evidence_expiry_sweep');
  });

  it('runOnce executes evidence_staleness check without error', () => {
    expect(() => scheduler.runOnce('evidence_staleness')).not.toThrow();
  });

  it('runOnce throws for unknown check name with available checks listed', () => {
    expect(() => scheduler.runOnce('unknown_check')).toThrowError(
      /Unknown check: unknown_check\. Available:/,
    );
  });
});
