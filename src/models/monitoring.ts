/**
 * Phase 8D — Continuous monitoring types.
 */

export interface MonitoringThresholds {
  id: string;
  scope_id: string | null;
  catalog_id: string | null;

  warning_threshold: number;
  critical_threshold: number;

  delta_warning: number;
  delta_critical: number;

  trend_window: number;

  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Severity level produced by a monitoring check. */
export type MonitorSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** One monitoring finding for a single (scope, catalog) pair. */
export interface PostureFinding {
  scope_id: string | null;
  catalog_id: string;
  catalog_short_name: string | null;
  current_score: number;
  previous_score: number | null;

  /** True if score crossed a threshold this run. */
  threshold_breached: boolean;
  threshold_severity: MonitorSeverity | null;
  threshold_kind: 'critical' | 'warning' | null;

  /** Drop magnitude between latest two snapshots (positive = drop). */
  delta: number | null;
  delta_breached: boolean;
  delta_severity: MonitorSeverity | null;

  /** How many consecutive drops including this snapshot. */
  consecutive_drops: number;
  trend_breached: boolean;

  /** IDs of drift alerts created/reused for this finding. */
  alert_ids: string[];
}

/** Summary returned by the posture monitor run. */
export interface PostureMonitorResult {
  checked_at: string;
  checked: number;
  findings: PostureFinding[];
  alerts_created: number;
}

export const DEFAULT_THRESHOLDS = {
  warning_threshold: 80,
  critical_threshold: 60,
  delta_warning: 5,
  delta_critical: 10,
  trend_window: 3,
} as const;
