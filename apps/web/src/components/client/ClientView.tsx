'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Clock, LayoutDashboard, Sparkles, TrendingUp } from 'lucide-react';
import { cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';
import { HourlyView } from '@/components/hourly/HourlyView';
import { DashboardView } from '@/components/dashboard/DashboardView';

export function ClientView({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { data: clients } = trpc.clients.list.useQuery();
  const client = clients?.find((c) => c.slug === slug);

  const viewParam = searchParams.get('view');
  const isPremium = client?.tier === 'premium';

  // Determine active view:
  // - If URL has explicit view=overview or view=hourly, respect it.
  // - Otherwise, Premium clients default to 'hourly', Standard clients default to 'overview' (GMV Brief).
  const currentView = viewParam ?? (isPremium ? 'hourly' : 'overview');

  const setView = (v: 'hourly' | 'overview') => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', v);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* View Switcher Bar for fast navigation */}
      <div className="flex items-center justify-between border-b border-border/80 pb-3">
        <div className="flex items-center gap-2">
          {isPremium ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-500 border border-amber-500/20">
              <Sparkles size={12} /> Premium Tier · Intraday Hourly
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-secondary border border-border">
              <TrendingUp size={12} /> Buzzohero Brand · GMV Brief
            </span>
          )}
        </div>

        {/* Tab Toggle */}
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-[12px] font-medium">
          {isPremium ? (
            <button
              type="button"
              onClick={() => setView('hourly')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1 transition-all',
                currentView === 'hourly'
                  ? 'bg-accent text-on-accent font-semibold shadow-xs'
                  : 'text-secondary hover:text-primary',
              )}
            >
              <Clock size={13} /> Hourly Intraday
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setView('overview')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1 transition-all',
              currentView === 'overview'
                ? 'bg-accent text-on-accent font-semibold shadow-xs'
                : 'text-secondary hover:text-primary',
            )}
          >
            <LayoutDashboard size={13} /> {isPremium ? 'Daily Overview' : 'GMV Brief'}
          </button>
        </div>
      </div>

      {/* Main View Component */}
      {currentView === 'hourly' && isPremium ? (
        <HourlyView slug={slug} onSwitchToOverview={() => setView('overview')} />
      ) : (
        <DashboardView slug={slug} isStandardGmvBrief={!isPremium} />
      )}
    </div>
  );
}
