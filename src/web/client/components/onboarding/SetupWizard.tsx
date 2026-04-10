import React, { useState, useEffect } from 'react';
import { useToastContext } from '../../App';
import { Rocket, ChevronRight, Check, SkipForward } from 'lucide-react';

const STAGES = [
  { num: 1, name: 'Organization', required: true },
  { num: 2, name: 'Frameworks', required: false },
  { num: 3, name: 'Scopes', required: false },
  { num: 4, name: 'Assets', required: false },
  { num: 5, name: 'Owners', required: false },
  { num: 6, name: 'Risks', required: false },
  { num: 7, name: 'Connectors', required: false },
  { num: 8, name: 'Review', required: true },
];

interface WizardState {
  current_stage: number;
  completed_stages: number[];
  skipped_stages: number[];
  org_id?: string;
  selected_catalogs: string[];
  scope_ids: string[];
  asset_ids: string[];
  owner_ids: string[];
  risk_ids: string[];
  connector_ids: string[];
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/onboarding${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const { add: toast } = useToastContext();
  const [state, setState] = useState<WizardState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/state').then(s => { setState(s); setLoading(false); });
  }, []);

  const completeStage = async (stage: number, data?: any) => {
    const s = await api(`/complete/${stage}`, { method: 'POST', body: JSON.stringify(data ?? {}) });
    setState(s);
    if (stage === 8) onComplete();
  };

  const skipStage = async (stage: number) => {
    const s = await api(`/skip/${stage}`, { method: 'POST' });
    setState(s);
  };

  if (loading || !state) return <div className="flex items-center justify-center h-screen"><div className="h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  const current = state.current_stage;

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-base)' }}>
      {/* Sidebar progress */}
      <div className="w-64 p-6 border-r" style={{ borderColor: 'var(--border-glass)', background: 'var(--bg-glass)' }}>
        <div className="flex items-center gap-2 mb-8">
          <Rocket className="h-5 w-5 text-indigo-400" />
          <h1 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>Attesting Setup</h1>
        </div>
        <div className="space-y-1">
          {STAGES.map(s => {
            const done = state.completed_stages.includes(s.num);
            const skipped = state.skipped_stages.includes(s.num);
            const active = current === s.num;
            return (
              <div key={s.num} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] ${active ? 'font-semibold' : ''}`}
                style={{ color: done ? '#4ade80' : skipped ? 'var(--text-dim)' : active ? '#818cf8' : 'var(--text-tertiary)',
                  background: active ? 'var(--bg-glass-active)' : 'transparent' }}>
                {done ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5 text-center text-[11px]">{s.num}</span>}
                <span>{s.name}</span>
                {skipped && <span className="text-[10px] ml-auto">skipped</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-8 max-w-3xl mx-auto">
        {current === 1 && <OrgStep onComplete={d => completeStage(1, d)} />}
        {current === 2 && <FrameworkStep state={state} onComplete={d => completeStage(2, d)} onSkip={() => skipStage(2)} />}
        {current === 3 && <ScopeStep state={state} onComplete={d => completeStage(3, d)} onSkip={() => skipStage(3)} />}
        {current === 4 && <AssetStep onComplete={d => completeStage(4, d)} onSkip={() => skipStage(4)} />}
        {current === 5 && <OwnerStep onComplete={d => completeStage(5, d)} onSkip={() => skipStage(5)} />}
        {current === 6 && <RiskStep state={state} onComplete={d => completeStage(6, d)} onSkip={() => skipStage(6)} />}
        {current === 7 && <ConnectorStep onComplete={d => completeStage(7, d)} onSkip={() => skipStage(7)} />}
        {current >= 8 && <ReviewStep state={state} onComplete={() => completeStage(8)} />}
      </div>
    </div>
  );
}

// ── Step Components ──────────────────────────────────────────

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[20px] font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="text-[13px]" style={{ color: 'var(--text-dim)' }}>{description}</p>
    </div>
  );
}

function SkipButton({ onSkip }: { onSkip: () => void }) {
  return (
    <button onClick={onSkip} className="glass-btn px-4 py-2 rounded-xl text-[12px] inline-flex items-center gap-1.5" style={{ color: 'var(--text-dim)' }}>
      <SkipForward className="h-3.5 w-3.5" /> Skip for now
    </button>
  );
}

function NextButton({ onClick, label = 'Continue' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="px-6 py-2 bg-indigo-600 text-white text-[13px] font-medium rounded-xl hover:bg-indigo-500 transition-colors inline-flex items-center gap-1.5">
      {label} <ChevronRight className="h-4 w-4" />
    </button>
  );
}

function OrgStep({ onComplete }: { onComplete: (d: any) => void }) {
  const [form, setForm] = useState({ name: '', industry: 'technology', size: 'small' });
  return (
    <div>
      <StepHeader title="Organization Setup" description="Let's start with your organization profile." />
      <div className="space-y-3">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Organization name" className="input-glass w-full" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} className="input-glass">
            {['defense', 'finance', 'healthcare', 'technology', 'government', 'other'].map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} className="input-glass">
            {['small', 'medium', 'large', 'enterprise'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-6">
        <NextButton onClick={() => form.name && onComplete(form)} />
      </div>
    </div>
  );
}

function FrameworkStep({ state, onComplete, onSkip }: { state: WizardState; onComplete: (d: any) => void; onSkip: () => void }) {
  const [recs, setRecs] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    api('/recommendations?industry=technology&size=small').then(r => {
      setRecs(r);
      setSelected(new Set(r.filter((x: any) => x.recommended).map((x: any) => x.shortName)));
    });
  }, []);

  const toggle = (s: string) => {
    const next = new Set(selected);
    next.has(s) ? next.delete(s) : next.add(s);
    setSelected(next);
  };

  return (
    <div>
      <StepHeader title="Select Compliance Frameworks" description="Choose which catalogs to activate. Recommended ones are pre-selected." />
      <div className="space-y-2">
        {recs.map(r => (
          <label key={r.shortName} className="glass-static rounded-xl p-4 flex items-center gap-3 cursor-pointer" onClick={() => toggle(r.shortName)}>
            <input type="checkbox" checked={selected.has(r.shortName)} readOnly className="accent-indigo-500" />
            <div className="flex-1">
              <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
              <span className="text-[11px] ml-2" style={{ color: 'var(--text-dim)' }}>{r.controlCount} controls</span>
            </div>
            {r.recommended && <span className="pill pill-blue text-[10px]">recommended</span>}
          </label>
        ))}
      </div>
      <div className="flex gap-3 mt-6">
        <NextButton onClick={() => onComplete({ selected_catalogs: [...selected] })} />
        <SkipButton onSkip={onSkip} />
      </div>
    </div>
  );
}

function ScopeStep({ state, onComplete, onSkip }: { state: WizardState; onComplete: (d: any) => void; onSkip: () => void }) {
  const [template, setTemplate] = useState('single');
  return (
    <div>
      <StepHeader title="Define Scopes" description="Scopes define the boundaries where your controls apply." />
      <div className="space-y-2">
        {[['single', 'Single scope — "All Systems"'], ['env', 'By environment — Production, Development, Corporate'], ['skip', 'I\'ll define scopes later']].map(([v, l]) => (
          <label key={v} className="glass-static rounded-xl p-4 flex items-center gap-3 cursor-pointer" onClick={() => setTemplate(v)}>
            <input type="radio" name="scope" checked={template === v} readOnly className="accent-indigo-500" />
            <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{l}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-3 mt-6">
        {template === 'skip' ? <SkipButton onSkip={onSkip} /> : <NextButton onClick={() => onComplete({ template })} />}
      </div>
    </div>
  );
}

function AssetStep({ onComplete, onSkip }: { onComplete: (d: any) => void; onSkip: () => void }) {
  const [assets, setAssets] = useState<Array<{ name: string; platform: string; type: string }>>([]);
  const [form, setForm] = useState({ name: '', platform: 'aws', type: 'application' });

  const add = () => {
    if (form.name) { setAssets([...assets, { ...form }]); setForm({ name: '', platform: 'aws', type: 'application' }); }
  };

  return (
    <div>
      <StepHeader title="Register Key Assets" description="Add the systems your controls protect. Start with the most critical." />
      {assets.length > 0 && (
        <div className="mb-4 space-y-1">
          {assets.map((a, i) => (
            <div key={i} className="glass-static rounded-lg px-4 py-2 text-[13px] flex justify-between" style={{ color: 'var(--text-primary)' }}>
              <span>{a.name}</span><span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{a.platform} / {a.type}</span>
            </div>
          ))}
        </div>
      )}
      <div className="glass-static rounded-xl p-4 space-y-3">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Asset name" className="input-glass w-full" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} className="input-glass">
            {['aws', 'azure', 'gcp', 'on-prem', 'saas', 'identity'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input-glass">
            {['application', 'infrastructure', 'data-store', 'network', 'endpoint'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={add} className="glass-btn px-4 py-1.5 rounded-xl text-[12px]" style={{ color: 'var(--text-secondary)' }}>+ Add asset</button>
      </div>
      <div className="flex gap-3 mt-6">
        <NextButton onClick={() => onComplete({ assets })} label={assets.length > 0 ? 'Continue' : 'Continue without assets'} />
        <SkipButton onSkip={onSkip} />
      </div>
    </div>
  );
}

function OwnerStep({ onComplete, onSkip }: { onComplete: (d: any) => void; onSkip: () => void }) {
  const [mode, setMode] = useState<'solo' | 'team'>('solo');
  const [form, setForm] = useState({ name: '', email: '' });
  return (
    <div>
      <StepHeader title="Assign Owners" description="Who manages your compliance program?" />
      <div className="space-y-2 mb-4">
        <label className="glass-static rounded-xl p-4 flex items-center gap-3 cursor-pointer" onClick={() => setMode('solo')}>
          <input type="radio" checked={mode === 'solo'} readOnly className="accent-indigo-500" />
          <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>I'm the sole owner</span>
        </label>
        <label className="glass-static rounded-xl p-4 flex items-center gap-3 cursor-pointer" onClick={() => setMode('team')}>
          <input type="radio" checked={mode === 'team'} readOnly className="accent-indigo-500" />
          <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>I'll add team members later</span>
        </label>
      </div>
      {mode === 'solo' && (
        <div className="glass-static rounded-xl p-4 space-y-3">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" className="input-glass w-full" />
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Your email" className="input-glass w-full" />
        </div>
      )}
      <div className="flex gap-3 mt-6">
        <NextButton onClick={() => onComplete({ mode, ...form })} />
        <SkipButton onSkip={onSkip} />
      </div>
    </div>
  );
}

function RiskStep({ state, onComplete, onSkip }: { state: WizardState; onComplete: (d: any) => void; onSkip: () => void }) {
  const [mode, setMode] = useState<'manual' | 'auto' | 'skip'>('auto');
  return (
    <div>
      <StepHeader title="Initial Risk Posture" description="Seed your risk register to give the dashboard something to show." />
      <div className="space-y-2">
        {[['auto', 'Auto-generate from framework gaps'], ['manual', 'I\'ll add risks manually later'], ['skip', 'Skip']].map(([v, l]) => (
          <label key={v} className="glass-static rounded-xl p-4 flex items-center gap-3 cursor-pointer" onClick={() => setMode(v as any)}>
            <input type="radio" checked={mode === v} readOnly className="accent-indigo-500" />
            <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{l}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-3 mt-6">
        {mode === 'skip' ? <SkipButton onSkip={onSkip} /> :
          <NextButton onClick={() => onComplete({ mode, catalogs: state.selected_catalogs })} />}
      </div>
    </div>
  );
}

function ConnectorStep({ onComplete, onSkip }: { onComplete: (d: any) => void; onSkip: () => void }) {
  const [enableKev, setEnableKev] = useState(true);
  return (
    <div>
      <StepHeader title="Connect Threat Feeds" description="Automated threat feeds correlate against your assets without manual effort." />
      <label className="glass-static rounded-xl p-4 flex items-center gap-3 cursor-pointer" onClick={() => setEnableKev(!enableKev)}>
        <input type="checkbox" checked={enableKev} readOnly className="accent-indigo-500" />
        <div>
          <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>CISA KEV</span>
          <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>Free, no API key. Known Exploited Vulnerabilities catalog.</p>
        </div>
        <span className="pill pill-green text-[10px] ml-auto">recommended</span>
      </label>
      <div className="flex gap-3 mt-6">
        <NextButton onClick={() => onComplete({ enableKev })} />
        <SkipButton onSkip={onSkip} />
      </div>
    </div>
  );
}

function ReviewStep({ state, onComplete }: { state: WizardState; onComplete: () => void }) {
  return (
    <div>
      <StepHeader title="Setup Complete" description="Here's a summary of your configuration." />
      <div className="glass-static rounded-xl p-6 space-y-3">
        <div className="grid grid-cols-2 gap-4 text-[13px]">
          <div><span style={{ color: 'var(--text-dim)' }}>Frameworks:</span> <strong style={{ color: 'var(--text-primary)' }}>{state.selected_catalogs.length}</strong></div>
          <div><span style={{ color: 'var(--text-dim)' }}>Scopes:</span> <strong style={{ color: 'var(--text-primary)' }}>{state.scope_ids.length}</strong></div>
          <div><span style={{ color: 'var(--text-dim)' }}>Assets:</span> <strong style={{ color: 'var(--text-primary)' }}>{state.asset_ids.length}</strong></div>
          <div><span style={{ color: 'var(--text-dim)' }}>Owners:</span> <strong style={{ color: 'var(--text-primary)' }}>{state.owner_ids.length}</strong></div>
          <div><span style={{ color: 'var(--text-dim)' }}>Risks:</span> <strong style={{ color: 'var(--text-primary)' }}>{state.risk_ids.length}</strong></div>
          <div><span style={{ color: 'var(--text-dim)' }}>Connectors:</span> <strong style={{ color: 'var(--text-primary)' }}>{state.connector_ids.length}</strong></div>
        </div>
      </div>
      <div className="mt-6">
        <NextButton onClick={onComplete} label="Launch Attesting" />
      </div>
    </div>
  );
}
