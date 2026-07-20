'use client';

import { Search } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export function Topbar() {
  return (
    <header
      className="sticky top-0 z-topbar flex h-14 items-center justify-between gap-4 border-b border-border bg-canvas/80 px-4 backdrop-blur-md sm:px-6"
      style={{ height: 'var(--layout-topbar-h)' }}
    >
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span className="hidden sm:inline">Clients</span>
        <span className="hidden sm:inline text-border-strong">/</span>
        <span className="font-medium text-secondary">Dashboard</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="hidden h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-secondary sm:flex"
        >
          <Search size={14} />
          <span>Search</span>
          <kbd className="ml-2 rounded border border-border bg-bg-subtle px-1.5 text-[10px] text-muted">⌘K</kbd>
        </button>
        <ThemeToggle />
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-info text-[12px] font-semibold text-on-accent">
          BM
        </div>
      </div>
    </header>
  );
}
