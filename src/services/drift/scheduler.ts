import type Database from 'better-sqlite3';
import { info, error as logError, success } from '../../utils/logger.js';
import {
  checkEvidenceStaleness,
  checkPolicyReviews,
  checkRiskExceptionExpiry,
  checkDispositionExpiry,
  checkManualIntelExpiry,
  fullPostureRecalculation,
} from './checks.js';
import { runPostureMonitor } from '../monitoring/posture-monitor.js';
import { sweepExpiry } from '../evidence/freshness.js';

type CheckFn = () => unknown;

/**
 * Background scheduler that runs drift-detection checks
 * at configured intervals. Can also run individual checks
 * on-demand via runOnce().
 */
export class DriftScheduler {
  private db: Database.Database;
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private running = false;

  constructor(db: Database.Database) {
    this.db = db;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.schedule('evidence_staleness',   () => checkEvidenceStaleness(this.db),    5 * 60_000);
    this.schedule('policy_reviews',       () => checkPolicyReviews(this.db),        60 * 60_000);
    this.schedule('risk_exceptions',      () => checkRiskExceptionExpiry(this.db),  60 * 60_000);
    this.schedule('disposition_expiry',   () => checkDispositionExpiry(this.db),    60 * 60_000);
    this.schedule('manual_intel_expiry',  () => checkManualIntelExpiry(this.db),    60 * 60_000);
    this.schedule('posture_recalc',       () => fullPostureRecalculation(this.db),  24 * 60 * 60_000);
    this.schedule('posture_monitor',      () => runPostureMonitor(this.db),         60 * 60_000);
    this.schedule('evidence_expiry_sweep',() => sweepExpiry(this.db),                60 * 60_000);

    success(`Drift scheduler started with ${this.intervals.size} checks`);
  }

  stop(): void {
    for (const [, interval] of this.intervals) clearInterval(interval);
    this.intervals.clear();
    this.running = false;
    info('Drift scheduler stopped');
  }

  /** Run a named check immediately (for CLI or testing). */
  runOnce(name: string): unknown {
    const checks: Record<string, CheckFn> = {
      evidence_staleness:  () => checkEvidenceStaleness(this.db),
      policy_reviews:      () => checkPolicyReviews(this.db),
      risk_exceptions:     () => checkRiskExceptionExpiry(this.db),
      disposition_expiry:  () => checkDispositionExpiry(this.db),
      manual_intel_expiry: () => checkManualIntelExpiry(this.db),
      posture_recalc:      () => fullPostureRecalculation(this.db),
      posture_monitor:     () => runPostureMonitor(this.db),
      evidence_expiry_sweep: () => sweepExpiry(this.db),
    };
    const fn = checks[name];
    if (!fn) throw new Error(`Unknown check: ${name}. Available: ${Object.keys(checks).join(', ')}`);
    return fn();
  }

  /** List all available check names. */
  listChecks(): string[] {
    return [
      'evidence_staleness', 'policy_reviews', 'risk_exceptions',
      'disposition_expiry', 'manual_intel_expiry', 'posture_recalc',
      'posture_monitor', 'evidence_expiry_sweep',
    ];
  }

  private schedule(name: string, fn: CheckFn, intervalMs: number): void {
    this.run(name, fn); // run immediately
    this.intervals.set(name, setInterval(() => this.run(name, fn), intervalMs));
  }

  private run(name: string, fn: CheckFn): void {
    const start = Date.now();
    try {
      const result = fn();
      info(`[drift] ${name} completed in ${Date.now() - start}ms`, result ?? '');
    } catch (err: any) {
      logError(`[drift] ${name} failed: ${err.message}`);
    }
  }
}
