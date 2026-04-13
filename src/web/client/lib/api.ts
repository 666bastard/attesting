const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Org
export const getOrg = () => request<{ org: any; scopes: any[] }>('/org');

// Catalogs
export const getCatalogs = () => request<any[]>('/catalogs');
export const getCatalog = (shortName: string) => request<any>(`/catalogs/${shortName}`);
export const getControls = (shortName: string, params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<{ controls: any[]; total: number; limit: number; offset: number }>(
    `/catalogs/${shortName}/controls${qs}`
  );
};

// Control params
export const getControlParams = (catalog: string, controlId: string) =>
  request<any[]>(`/catalogs/${catalog}/controls/${controlId}/params`);
export const setControlParam = (catalog: string, controlId: string, paramId: string, value: string, setBy?: string) =>
  request<{ updated: boolean }>(`/catalogs/${catalog}/controls/${controlId}/params/${paramId}`, {
    method: 'PUT', body: JSON.stringify({ value, set_by: setBy }),
  });

// Coverage
export const getCoverage = (scopeName?: string) =>
  request<any[]>(scopeName ? `/coverage/${encodeURIComponent(scopeName)}` : '/coverage');

// Mappings
export const getMappingSummary = () =>
  request<{ total: number; byTarget: any[]; sourceControls: any[] }>('/mappings/summary');
export const resolveMappings = (catalog: string, controlId: string, depth?: number) =>
  request<{ control: any; direct: any[]; transitive: any[] }>(
    `/mappings/resolve/${catalog}/${controlId}${depth ? `?depth=${depth}` : ''}`
  );
export const listMappings = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<any[]>(`/mappings/list${qs}`);
};

// Implementations
export const getImplementations = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<{ implementations: any[]; total: number }>(`/implementations${qs}`);
};
export const getRecentImplementations = () => request<any[]>('/implementations/recent');
export const createImplementation = (data: Record<string, unknown>) =>
  request<{ id: string }>('/implementations', { method: 'POST', body: JSON.stringify(data) });
export const updateImplementation = (id: string, data: Record<string, unknown>) =>
  request<{ id: string }>(`/implementations/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Diff
export const runDiff = (oldCatalog: string, newCatalog: string) =>
  request<any>('/diff', { method: 'POST', body: JSON.stringify({ old: oldCatalog, new: newCatalog }) });

// Export
export const runExport = (format: string, catalog?: string, scope?: string) =>
  request<any>('/export', { method: 'POST', body: JSON.stringify({ format, catalog, scope }) });

// Watches
export const getWatches = () => request<any[]>('/watches');

// Governance
export const getPolicies = () => request<any[]>('/governance/policies');
export const createPolicy = (data: Record<string, unknown>) =>
  request<{ id: string }>('/governance/policies', { method: 'POST', body: JSON.stringify(data) });
export const getPolicy = (id: string) => request<any>(`/governance/policies/${id}`);
export const updatePolicy = (id: string, data: Record<string, unknown>) =>
  request<any>(`/governance/policies/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePolicy = (id: string) =>
  request<any>(`/governance/policies/${id}`, { method: 'DELETE' });
export const linkPolicyControls = (id: string, controlIds: string[]) =>
  request<any>(`/governance/policies/${id}/controls`, { method: 'POST', body: JSON.stringify({ controlIds }) });
export const getCommittees = () => request<any[]>('/governance/committees');
export const createCommittee = (data: Record<string, unknown>) =>
  request<{ id: string }>('/governance/committees', { method: 'POST', body: JSON.stringify(data) });
export const getCommitteeMeetings = (id: string) => request<any[]>(`/governance/committees/${id}/meetings`);
export const createMeeting = (id: string, data: Record<string, unknown>) =>
  request<{ id: string }>(`/governance/committees/${id}/meetings`, { method: 'POST', body: JSON.stringify(data) });
export const getRoles = () => request<any[]>('/governance/roles');
export const createRole = (data: Record<string, unknown>) =>
  request<{ id: string }>('/governance/roles', { method: 'POST', body: JSON.stringify(data) });
export const updateRole = (id: string, data: Record<string, unknown>) =>
  request<any>(`/governance/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Risk
export const getRisks = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<any[]>(`/risk/register${qs}`);
};
export const createRisk = (data: Record<string, unknown>) =>
  request<{ id: string; risk_id: string }>('/risk/register', { method: 'POST', body: JSON.stringify(data) });
export const getRisk = (id: string) => request<any>(`/risk/register/${id}`);
export const updateRisk = (id: string, data: Record<string, unknown>) =>
  request<any>(`/risk/register/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRisk = (id: string) =>
  request<any>(`/risk/register/${id}`, { method: 'DELETE' });
export const linkRiskControls = (id: string, controlIds: string[]) =>
  request<any>(`/risk/register/${id}/controls`, { method: 'POST', body: JSON.stringify({ controlIds }) });
export const getRiskMatrix = () => request<any>('/risk/matrix');
export const getRiskExceptions = () => request<any[]>('/risk/exceptions');
export const createRiskException = (data: Record<string, unknown>) =>
  request<{ id: string }>('/risk/exceptions', { method: 'POST', body: JSON.stringify(data) });
export const getRiskDashboard = () => request<any>('/risk/dashboard');

// Assets
export const getAssets = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<any[]>(`/assets${qs}`);
};
export const getAsset = (id: string) => request<any>(`/assets/${id}`);
export const createAsset = (data: Record<string, unknown>) =>
  request<{ id: string }>('/assets', { method: 'POST', body: JSON.stringify(data) });
export const updateAsset = (id: string, data: Record<string, unknown>) =>
  request<any>(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAsset = (id: string) =>
  request<any>(`/assets/${id}`, { method: 'DELETE' });

// Intel
export const getThreats = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<any[]>(`/intel/threats${qs}`);
};
export const getThreat = (id: string) => request<any>(`/intel/threats/${id}`);
export const getManualIntel = () => request<any[]>('/intel/manual');
export const submitManualIntel = (data: Record<string, unknown>) =>
  request<any>('/intel/manual', { method: 'POST', body: JSON.stringify(data) });
export const getShadowImpact = (id: string) => request<any>(`/intel/manual/${id}/shadow`);
export const promoteIntel = (id: string, data?: Record<string, unknown>) =>
  request<any>(`/intel/manual/${id}/promote`, { method: 'POST', body: JSON.stringify(data ?? {}) });

// Drift
export const getDriftAlerts = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<any[]>(`/drift/alerts${qs}`);
};
export const getDriftAlert = (id: string) => request<any>(`/drift/alerts/${id}`);
export const getDriftDashboard = () => request<any>('/drift/dashboard');
export const submitDisposition = (data: Record<string, unknown>) =>
  request<any>('/drift/dispositions', { method: 'POST', body: JSON.stringify(data) });
export const commitDisposition = (data: Record<string, unknown>) =>
  request<any>('/drift/dispositions/commit', { method: 'POST', body: JSON.stringify(data) });
export const getPendingDispositions = () => request<any[]>('/drift/dispositions/pending');

// Connectors
export const getConnectors = () => request<any[]>('/connectors');
export const createConnector = (data: Record<string, unknown>) =>
  request<{ id: string }>('/connectors', { method: 'POST', body: JSON.stringify(data) });
export const triggerSync = (id: string, full = false) =>
  request<any>(`/connectors/${id}/sync`, { method: 'POST', body: JSON.stringify({ full }) });
export const getConnectorLogs = (id: string, limit = 20) =>
  request<any[]>(`/connectors/${id}/logs?limit=${limit}`);
export const runHealthcheck = (id: string) =>
  request<any>(`/connectors/${id}/healthcheck`, { method: 'POST' });
export const getAdapters = () => request<string[]>('/connectors/adapters');

// Owners (shared)
export const getOwners = () => request<any[]>('/owners');

// Dashboard (Phase 8B)
export interface DashboardSummary {
  scope: { ref: string; id: string | null };
  compliance: {
    overall_score: number;
    catalog_count: number;
    best_catalog: FrameworkScore | null;
    worst_catalog: FrameworkScore | null;
  };
  frameworks: FrameworkScore[];
  trend: {
    catalog_id: string | null;
    since_days: number;
    points: Array<{ calculated_at: string; overall_score: number }>;
  };
  coverage: {
    total_controls: number;
    implemented: number;
    partial: number;
    planned: number;
    alternative: number;
    not_implemented: number;
    not_applicable: number;
    effective_total: number;
    implemented_pct: number;
  };
  risk: {
    total_open: number;
    above_appetite: number;
    by_severity: Array<{ severity: string; count: number }>;
    top: Array<{ risk_id: string; title: string; inherent_risk_score: number; residual_risk_score: number | null; owner: string; status: string }>;
  };
  drift: {
    active: number;
    by_severity: Array<{ severity: string; count: number }>;
    pending_dispositions: number;
    recent: Array<{ id: string; alert_type: string; severity: string; title: string; created_at: string }>;
  };
  evidence: {
    total: number;
    fresh: number;
    stale: number;
    expiring_soon: number;
    fresh_pct: number;
  };
  poam: {
    total_open: number;
    by_priority: Array<{ priority: string; count: number }>;
    overdue: number;
  };
  generated_at: string;
}
export interface FrameworkScore {
  catalog_id: string;
  catalog_short_name: string | null;
  catalog_name: string | null;
  overall_score: number;
  coverage_score: number | null;
  evidence_score: number | null;
  assessment_score: number | null;
  total_controls: number;
  implemented_count: number;
}
export const getDashboardSummary = (scope?: string, catalog?: string, trendDays?: number) => {
  const qs = new URLSearchParams();
  if (scope) qs.set('scope', scope);
  if (catalog) qs.set('catalog', catalog);
  if (trendDays) qs.set('trendDays', String(trendDays));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<DashboardSummary>(`/dashboard/summary${suffix}`);
};

// Evidence lifecycle (Phase 8E)
export type EvidenceStatus = 'draft' | 'submitted' | 'reviewed' | 'accepted' | 'rejected' | 'expiring' | 'expired' | 'archived';
export type EvidenceAction = 'submit' | 'review' | 'accept' | 'reject' | 'revise' | 'renew' | 'archive';
export type EvidenceFreshness = 'fresh' | 'expiring_soon' | 'expired' | 'pending' | 'rejected' | 'archived';

export interface EvidenceRow {
  id: string;
  title: string;
  description?: string;
  status: EvidenceStatus;
  freshness?: EvidenceFreshness;
  version: number;
  implementation_id?: string;
  evidence_type: string;
  collected_at?: string;
  collected_by?: string;
  valid_from?: string | null;
  valid_until?: string | null;
  renewal_period_days?: number | null;
  reviewer_id?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  last_state_change_at?: string | null;
  created_at: string;
}

export interface EvidenceFreshnessSummary {
  overall: { fresh: number; expiring_soon: number; expired: number; pending: number; rejected: number; archived: number };
  by_catalog: Array<{
    catalog_id: string;
    catalog_short_name: string;
    fresh: number; expiring_soon: number; expired: number; pending: number; rejected: number; archived: number;
    total: number;
    controls_with_evidence: number;
    controls_missing_evidence: number;
    total_controls: number;
  }>;
  generated_at: string;
}

export const listEvidence = (filters?: { status?: string; implementation_id?: string; expiring_within_days?: number }) => {
  const qs = new URLSearchParams();
  if (filters?.status) qs.set('status', filters.status);
  if (filters?.implementation_id) qs.set('implementation_id', filters.implementation_id);
  if (filters?.expiring_within_days) qs.set('expiring_within_days', String(filters.expiring_within_days));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<EvidenceRow[]>(`/evidence${suffix}`);
};
export const getEvidenceDetail = (id: string) =>
  request<EvidenceRow & { history: any[] }>(`/evidence/${id}`);
export const transitionEvidence = (id: string, body: { action: EvidenceAction; reviewer_id?: string; notes?: string; renewal_period_days?: number }) =>
  request<EvidenceRow>(`/evidence/${id}/transition`, { method: 'POST', body: JSON.stringify(body) });
export const getEvidenceFreshness = () =>
  request<EvidenceFreshnessSummary>('/evidence/freshness');

// Monitoring (Phase 8D)
export interface PostureFinding {
  scope_id: string | null;
  catalog_id: string;
  catalog_short_name: string | null;
  current_score: number;
  previous_score: number | null;
  threshold_breached: boolean;
  threshold_severity: string | null;
  threshold_kind: 'critical' | 'warning' | null;
  delta: number | null;
  delta_breached: boolean;
  delta_severity: string | null;
  consecutive_drops: number;
  trend_breached: boolean;
  alert_ids: string[];
}
export interface MonitoringStatus {
  generated_at: string;
  summary: {
    total_checked: number;
    threshold_breaches: number;
    delta_breaches: number;
    trend_breaches: number;
    declining: number;
  };
  findings: PostureFinding[];
  recent_alerts: Array<{ id: string; severity: string; title: string; message: string; created_at: string; resolved_at: string | null }>;
}
export const getMonitoringStatus = () => request<MonitoringStatus>('/monitoring/status');
export const runMonitoringCheck = () => request<any>('/monitoring/run', { method: 'POST' });

// Scores (Phase 8A)
export const getScoreHistory = (scopeRef: string, catalogRef: string, days = 90) =>
  request<{ entries: Array<{ calculated_at: string; overall_score: number }>; since_days: number }>(
    `/scores/${encodeURIComponent(scopeRef)}/${encodeURIComponent(catalogRef)}/history?days=${days}`,
  );
export const snapshotScore = (scopeRef: string, catalogRef: string) =>
  request<any>(`/scores/${encodeURIComponent(scopeRef)}/${encodeURIComponent(catalogRef)}/snapshot`, { method: 'POST' });
