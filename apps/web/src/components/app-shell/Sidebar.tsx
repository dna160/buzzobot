'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { BarChart3, Clock, LayoutDashboard, Radio, Settings, SlidersHorizontal, Sparkles, TrendingUp, Video } from 'lucide-react';
import { cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';
import { ClientSwitcher } from './ClientSwitcher';

/**
 * Names the configured data source. Real brand data must never sit under a
 * "demo mode" label, so this reflects the actual provider rather than a
 * hardcoded string.
 */
function DataSourceBadge() {
  const { data } = trpc.clients.dataSource.useQuery();
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted">
      <span className={cn('h-1.5 w-1.5 rounded-full', data?.isDemo ? 'bg-warning' : 'bg-success')} />
      {data?.label ?? 'Checking data source…'}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams<{ slug?: string }>();
  const slug = params?.slug ?? 'cimory';
  const { data: clients } = trpc.clients.list.useQuery();
  const activeClient = clients?.find((c) => c.slug === slug);
  const isPremium = activeClient?.tier === 'premium';

  const navItems = [
    {
      label: isPremium ? 'Hourly Telemetry' : 'GMV Brief',
      icon: isPremium ? Clock : TrendingUp,
      href: `/clients/${slug}`,
    },
    {
      label: 'Performance Overview',
      icon: LayoutDashboard,
      href: `/clients/${slug}?view=overview`,
    },
    // Per client × objective, so it lives under the client rather than Settings.
    {
      label: 'Deck config',
      icon: SlidersHorizontal,
      href: `/clients/${slug}/deck`,
    },
    {
      label: 'Paid Campaigns',
      icon: BarChart3,
      href: `/clients/${slug}#paid`,
      soon: true,
    },
    {
      label: 'Organic Content',
      icon: Video,
      href: `/clients/${slug}#organic`,
      soon: true,
    },
    {
      label: 'Live Signals',
      icon: Radio,
      href: '#',
      soon: true,
    },
    {
      label: 'Settings',
      icon: Settings,
      href: '/settings',
    },
  ];

  return (
    <aside
      className="fixed inset-y-0 left-0 z-sidebar hidden w-[248px] flex-col border-r border-border bg-bg-subtle lg:flex"
      style={{ width: 'var(--layout-sidebar-w)' }}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-on-accent shadow-xs">
            <Sparkles size={16} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-primary">Tempo</span>
          <span className="rounded bg-surface-active px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
            Insight
          </span>
        </div>
      </div>

      <div className="px-3 pb-2">
        <ClientSwitcher />
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {navItems.map((item) => {
          const soon = 'soon' in item && item.soon;
          // Active when the current path matches this item's destination
          const isItemActive =
            !soon &&
            item.href !== '#' &&
            (pathname === item.href || (item.href.includes('?view=') && pathname === item.href.split('?')[0]));
          const Icon = item.icon;

          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                isItemActive
                  ? 'bg-surface-active text-primary'
                  : 'text-secondary hover:bg-surface-hover hover:text-primary',
              )}
            >
              <Icon
                size={16}
                className={cn(isItemActive ? 'text-accent' : 'text-muted group-hover:text-secondary')}
              />
              <span className="flex-1 truncate">{item.label}</span>
              {soon ? (
                <span className="rounded bg-surface-active px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                  Soon
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <DataSourceBadge />
      </div>
    </aside>
  );
}
