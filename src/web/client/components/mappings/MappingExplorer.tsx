import React, { useState, useCallback } from 'react';
import { Search, GitCompareArrows, ArrowRight } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { getMappingSummary, resolveMappings } from '../../lib/api';
import MappingGraph from './MappingGraph';
import ResolveView from './ResolveView';
import ControlDetail from './ControlDetail';

const STATUS_DOT_CLASS: Record<string, string> = {
  'implemented': 'status-dot-green',
  'partially-implemented': 'status-dot-amber',
  'planned': 'status-dot-blue',
  'not-applicable': 'status-dot-gray',
};

export default function MappingExplorer() {
  const [search, setSearch] = useState('');
  const [resolveData, setResolveData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTextView, setShowTextView] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);

  const { data: summary } = useApi(() => getMappingSummary(), []);

  const doResolve = useCallback(async (catalog: string, controlId: string) => {
    setLoading(true);
    setError('');
    setSelectedNode(null);
    try {
      const result = await resolveMappings(catalog.trim(), controlId.trim(), 3);
      setResolveData(result);
      setSearch(`${catalog}:${controlId}`);
    } catch (err: any) {
      setError(err.message);
      setResolveData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(() => {
    if (!search.includes(':')) {
      setError('Format: catalog:control_id (e.g., sig-lite-2026:A.1)');
      return;
    }
    const [catalog, controlId] = search.split(':', 2);
    doResolve(catalog, controlId);
  }, [search, doResolve]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!resolveData) return;
    // Find the node data in direct/transitive
    const allNodes = [...resolveData.direct, ...resolveData.transitive];
    const node = allNodes.find((m: any) =>
      `${m.catalogShortName}:${m.controlNativeId}` === nodeId
    );
    if (node) {
      setSelectedNode(node);
    } else if (nodeId === `${resolveData.control.catalog_short_name}:${resolveData.control.control_id}`) {
      setSelectedNode({ ...resolveData.control, isRoot: true });
    }
  }, [resolveData]);

  const handleNodeNavigate = useCallback((nodeId: string) => {
    const [catalog, controlId] = nodeId.split(':', 2);
    if (catalog && controlId) {
      doResolve(catalog, controlId);
    }
  }, [doResolve]);

  return (
    <div className="flex h-[calc(100vh-49px)]">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar */}
        <div className="flex items-center gap-3 p-4 glass-header">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2 h-4 w-4" style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
            <label htmlFor="mapping-search" className="sr-only">Search control (catalog:control_id)</label>
            <input id="mapping-search" type="text" value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="sig-lite-2026:A.1"
              className="input-glass w-full pl-9" />
          </div>
          <button onClick={handleSearch} disabled={loading}
            className="px-4 py-1.5 bg-indigo-600 text-white text-[13px] font-medium rounded-xl hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 transition-colors shadow-lg shadow-indigo-600/20">
            {loading ? 'Resolving...' : 'Resolve'}
          </button>
          {resolveData && (
            <div className="flex items-center rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-glass)' }}>
              <button onClick={() => setShowTextView(false)}
                className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${!showTextView ? 'glass-btn-active' : 'glass-btn'}`}
                aria-pressed={!showTextView}>Graph</button>
              <button onClick={() => setShowTextView(true)}
                className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${showTextView ? 'glass-btn-active' : 'glass-btn'}`}
                aria-pressed={showTextView}>Text</button>
            </div>
          )}
          {error && <span className="text-[13px] text-rose-400" role="alert">{error}</span>}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {!resolveData ? (
            <SummaryView summary={summary} onResolve={doResolve} />
          ) : showTextView ? (
            <ResolveView data={resolveData} onNodeClick={handleNodeClick} onNavigate={handleNodeNavigate} />
          ) : (
            <MappingGraph data={resolveData} selectedNodeId={selectedNode ? `${selectedNode.catalogShortName ?? selectedNode.catalog_short_name}:${selectedNode.controlNativeId ?? selectedNode.control_id}` : null} onNodeClick={handleNodeClick} onNodeNavigate={handleNodeNavigate} />
          )}
        </div>
      </div>

      {/* Right detail panel */}
      {selectedNode && resolveData && (
        <ControlDetail
          node={selectedNode}
          rootControl={resolveData.control}
          allMappings={[...resolveData.direct, ...resolveData.transitive]}
          onClose={() => setSelectedNode(null)}
          onNavigate={handleNodeNavigate}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default summary view
// ---------------------------------------------------------------------------

function SummaryView({ summary, onResolve }: { summary: any; onResolve: (cat: string, id: string) => void }) {
  if (!summary) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading mapping summary...
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        <div className="text-center">
          <GitCompareArrows className="h-8 w-8 mx-auto mb-2 text-gray-300" aria-hidden="true" />
          <p>No mappings yet</p>
          <p className="text-xs mt-1">Run <code className="bg-gray-100 px-1 rounded">attesting mapping auto-link</code> to generate cross-framework mappings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="glass-static rounded-2xl p-4">
          <p className="text-2xl font-bold text-indigo-400">{summary.total}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Total mappings</p>
        </div>
        <div className="glass-static rounded-2xl p-4">
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{summary.sourceControls.length}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Source controls</p>
        </div>
        <div className="glass-static rounded-2xl p-4">
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{summary.byTarget.length}</p>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Target frameworks</p>
        </div>
      </div>

      {/* Target breakdown */}
      <div className="glass-static rounded-2xl p-5 mb-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-dim)' }}>Mappings by Target Framework</h3>
        <div className="space-y-2">
          {summary.byTarget.map((t: any) => {
            const pct = summary.total > 0 ? Math.round((t.count / summary.total) * 100) : 0;
            return (
              <div key={t.short_name} className="flex items-center gap-3">
                <span className="text-[12px] w-40 truncate" style={{ color: 'var(--text-secondary)' }}>{t.short_name}</span>
                <div className="flex-1 rounded-full h-1.5" style={{ background: 'var(--ring-track)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.name}: ${t.count} mappings`}>
                  <div className="bg-indigo-500 rounded-full h-1.5 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[12px] font-medium w-10 text-right" style={{ color: 'var(--text-primary)' }}>{t.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Source controls table */}
      <div className="glass-static rounded-2xl overflow-hidden">
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-glass)' }}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Source Controls — Click to Explore</h3>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full glass-table" role="table">
            <caption className="sr-only">Source controls with mapping counts</caption>
            <thead className="sticky top-0">
              <tr>
                <th scope="col" className="w-8"></th>
                <th scope="col" className="w-40">Control</th>
                <th scope="col">Title</th>
                <th scope="col" className="w-24 text-right">Mappings</th>
                <th scope="col" className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {summary.sourceControls.map((sc: any) => {
                const dotCls = STATUS_DOT_CLASS[sc.impl_status] ?? 'status-dot-rose';
                return (
                  <tr key={`${sc.catalog_short_name}:${sc.control_id}`}
                    className="cursor-pointer" onClick={() => onResolve(sc.catalog_short_name, sc.control_id)}>
                    <td><span className={`status-dot ${dotCls}`} role="img" aria-label={sc.impl_status ?? 'not implemented'} /></td>
                    <td className="font-mono font-medium text-indigo-400">{sc.catalog_short_name}:{sc.control_id}</td>
                    <td className="truncate max-w-sm">{sc.title}</td>
                    <td className="font-medium text-right" style={{ color: 'var(--text-primary)' }}>{sc.mapping_count}</td>
                    <td><ArrowRight className="h-3.5 w-3.5" style={{ color: 'var(--text-dim)' }} aria-hidden="true" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
