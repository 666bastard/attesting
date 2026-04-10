import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { getOrg } from '../../lib/api';
import ThemeToggle from './ThemeToggle';

interface HeaderProps {
  scope: string;
  onScopeChange: (scope: string) => void;
}

export default function Header({ scope, onScopeChange }: HeaderProps) {
  const [orgName, setOrgName] = useState('');
  const [scopes, setScopes] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    getOrg().then(({ org, scopes: s }) => {
      setOrgName(org?.name ?? 'Attesting');
      setScopes(s);
    }).catch(() => {});
  }, []);

  return (
    <header className="glass-header flex items-center justify-between px-6 py-2.5 relative z-20" role="banner">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg" style={{ background: 'var(--bg-glass-strong)' }}>
          <Building2 className="h-3.5 w-3.5" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
        </div>
        <h1 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{orgName}</h1>
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <label htmlFor="scope-select" className="sr-only">Scope</label>
        <select
          id="scope-select"
          value={scope}
          onChange={(e) => onScopeChange(e.target.value)}
          className="input-glass text-[12px] py-1.5 px-3"
          aria-label="Select scope"
        >
          <option value="">All scopes</option>
          {scopes.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
