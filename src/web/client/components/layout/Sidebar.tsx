import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Library, GitCompareArrows, FileEdit,
  ArrowLeftRight, Download, Upload, Shield, ScrollText, AlertTriangle,
  ChevronDown, ChevronRight, ShieldCheck, Scale, ClipboardCheck,
  Server, Radio, Plug
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Governance',
    icon: Scale,
    items: [
      { to: '/governance/policies', label: 'Policies', icon: ScrollText },
      { to: '/governance/committees', label: 'Committees', icon: ClipboardCheck },
      { to: '/governance/roles', label: 'Roles', icon: ShieldCheck },
    ],
  },
  {
    label: 'Risk',
    icon: AlertTriangle,
    items: [
      { to: '/risk/register', label: 'Risk Register', icon: AlertTriangle },
      { to: '/risk/matrix', label: 'Risk Matrix', icon: LayoutDashboard },
      { to: '/risk/exceptions', label: 'Exceptions', icon: ShieldCheck },
      { to: '/risk/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Operations',
    icon: Shield,
    items: [
      { to: '/assets', label: 'Assets', icon: Server },
      { to: '/intel/threats', label: 'Intel', icon: Radio },
      { to: '/drift/dashboard', label: 'Drift', icon: Shield },
      { to: '/connectors', label: 'Connectors', icon: Plug },
    ],
  },
  {
    label: 'Compliance',
    icon: ClipboardCheck,
    items: [
      { to: '/catalogs', label: 'Frameworks', icon: Library },
      { to: '/mappings', label: 'Mappings', icon: GitCompareArrows },
      { to: '/implementations', label: 'Implementations', icon: FileEdit },
      { to: '/diff', label: 'Diff Viewer', icon: ArrowLeftRight },
      { to: '/import', label: 'Import', icon: Upload },
      { to: '/export', label: 'Export', icon: Download },
    ],
  },
];

function NavItemLink({ to, label, icon: Icon }: NavItem) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-[6px] rounded-lg text-[12px] font-medium transition-all duration-100 ${
          isActive ? 'glass-btn-active' : ''
        }`
      }
      style={({ isActive }) => ({
        color: isActive ? '#818cf8' : 'var(--text-tertiary)',
        background: isActive ? 'var(--bg-glass-active)' : undefined,
        borderLeft: isActive ? '2px solid #818cf8' : '2px solid transparent',
        paddingLeft: '8px',
      })}
    >
      <Icon className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

function CollapsibleSection({ section }: { section: NavSection }) {
  const location = useLocation();
  const isChildActive = section.items.some((item) => location.pathname.startsWith(item.to));
  const [expanded, setExpanded] = useState(isChildActive);

  // Auto-expand when a child route becomes active
  React.useEffect(() => {
    if (isChildActive && !expanded) setExpanded(true);
  }, [isChildActive]);

  const Icon = section.icon;

  return (
    <li>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-[7px] rounded-lg text-[12px] font-semibold transition-all duration-100 uppercase tracking-wider"
        style={{ color: isChildActive ? '#818cf8' : 'var(--text-dim)' }}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
          {section.label}
        </span>
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
          : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        }
      </button>
      {expanded && (
        <ul className="ml-3 mt-0.5 space-y-0.5" style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '8px' }} role="list">
          {section.items.map((item) => (
            <li key={item.to}>
              <NavItemLink {...item} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Sidebar() {
  return (
    <aside
      className="flex flex-col w-56 h-screen sticky top-0 relative z-20 overflow-y-auto"
      style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-glass)' }}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid var(--border-glass)' }}>
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-indigo-600 shadow-lg shadow-indigo-600/20">
          <Shield className="h-4 w-4 text-white" aria-hidden="true" />
        </div>
        <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>Attesting</span>
      </div>

      <nav className="flex-1 py-2">
        <ul className="space-y-0.5 px-2" role="list">
          {/* Dashboard — top-level, always visible */}
          <li>
            <NavItemLink to="/" label="Dashboard" icon={LayoutDashboard} />
          </li>

          {/* Collapsible GRC sections */}
          {sections.map((section) => (
            <CollapsibleSection key={section.label} section={section} />
          ))}
        </ul>
      </nav>

      <div className="px-5 py-3 text-[11px] tracking-wide" style={{ color: 'var(--text-dim)', borderTop: '1px solid var(--border-glass)' }}>
        v0.2.0
      </div>
    </aside>
  );
}
