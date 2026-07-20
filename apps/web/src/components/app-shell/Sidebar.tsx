'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { BarChart3, LayoutDashboard, Radio, Settings, Sparkles, Video } from 'lucide-react';
import { cn } from '@tempo/ui';
import { ClientSwitcher } from './ClientSwitcher';

const NAV = [
  { label: 'Overview', icon: LayoutDashboard, href: (slug: string) => `/clients/${slug}` },
  { label: 'Paid Campaigns', icon: BarChart3, href: (slug: string) => `/clients/${slug}#paid`, soon: true },
  { label: 'Organic Content', icon: Video, href: (slug: string) => `/clients/${slug}#organic`, soon: true },
  { label: 'Live Signals', icon: Radio, href: () => '#', soon: true },
  { label: 'Settings', icon: Settings, href: () => '#', soon: true },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ slug?: string }>();
  const slug = params?.slug ?? 'aurora-skincare';

  return (
    <aside
      className="fixed inset-y-0 left-0 z-sidebar hidden w-[248px] flex-col border-r border-border bg-bg-subtle lg:flex"
      style={{ width: 'var(--layout-sidebar-w)' }}
    >
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-on-accent">
          <Sparkles size={16} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-primary">Tempo</span>
        <span className="rounded bg-surface-active px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          Insight
        </span>
      </div>

      <div className="px-3 pb-2">
        <ClientSwitcher />
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const href = item.href(slug);
          const active = !('soon' in item && item.soon) && pathname === `/clients/${slug}`;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={href}
              className={cn(
                'group flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                active
                  ? 'bg-surface-active text-primary'
                  : 'text-secondary hover:bg-surface-hover hover:text-primary',
              )}
            >
              <Icon size={17} className={cn(active ? 'text-accent' : 'text-muted group-hover:text-secondary')} />
              <span className="flex-1">{item.label}</span>
              {'soon' in item && item.soon ? (
                <span className="rounded bg-surface-active px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                  Soon
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Fixture data · demo mode
        </div>
      </div>
    </aside>
  );
}
