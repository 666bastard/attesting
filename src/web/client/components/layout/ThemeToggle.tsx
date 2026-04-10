import React, { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'attesting-theme';

function getSystemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === 'light' || (theme === 'system' && !getSystemPrefersDark())) {
    html.classList.add('light');
  } else {
    html.classList.remove('light');
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'dark';
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Apply on mount
  useEffect(() => { applyTheme(theme); }, []);

  const cycle = () => {
    setTheme((prev) => prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark');
  };

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label = theme === 'light' ? 'Light mode' : theme === 'dark' ? 'Dark mode' : 'System theme';

  return (
    <button
      onClick={cycle}
      className="glass-btn p-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
      aria-label={`${label} — click to change`}
      title={label}
    >
      <Icon className="h-4 w-4" style={{ color: 'var(--text-tertiary)' }} />
    </button>
  );
}
