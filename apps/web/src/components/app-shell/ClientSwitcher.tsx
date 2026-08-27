'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Check, ChevronsUpDown, Search, Sparkles, TrendingUp, X } from 'lucide-react';
import { Badge, cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';

/** Dropdown to switch the active client; groups by Premium vs GMV Brief with live search. */
export function ClientSwitcher() {
  const router = useRouter();
  const params = useParams<{ slug?: string }>();
  const { data: clients } = trpc.clients.list.useQuery();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  const active = clients?.find((c) => c.slug === params?.slug) ?? clients?.[0];

  const filtered = useMemo(() => {
    if (!clients) return { premium: [], standard: [] };
    const q = search.trim().toLowerCase();
    const list = q
      ? clients.filter(
          (c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
        )
      : clients;

    return {
      premium: list.filter((c) => c.tier === 'premium'),
      standard: list.filter((c) => c.tier !== 'premium'),
    };
  }, [clients, search]);

  const totalFiltered = filtered.premium.length + filtered.standard.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition-all hover:border-border-strong hover:bg-surface-hover active:scale-[0.99]"
      >
        <span
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-on-accent shadow-sm"
          style={{ backgroundColor: active?.brandColor ?? 'var(--color-accent)' }}
        >
          {active?.name?.charAt(0) ?? 'T'}
          {active?.tier === 'premium' ? (
            <span
              title="Premium Intraday Telemetry"
              className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black ring-1 ring-bg"
            >
              ★
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-primary">
            {active?.name ?? 'Select client'}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted">
            {active?.tier === 'premium' ? (
              <span className="inline-flex items-center gap-0.5 font-medium text-amber-500">
                <Sparkles size={10} /> Premium Hourly
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 font-medium text-secondary">
                <TrendingUp size={10} /> GMV Brief
              </span>
            )}
          </span>
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-muted" />
      </button>

      {open && clients ? (
        <div className="absolute left-0 right-0 top-full z-dropdown mt-1.5 max-h-[380px] overflow-hidden rounded-xl border border-border bg-elevated shadow-xl backdrop-blur-md">
          {/* Search bar */}
          <div className="sticky top-0 z-10 border-b border-border bg-elevated/95 p-2 backdrop-blur-sm">
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-2.5 text-muted pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Buzzohero brands…"
                className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-7 text-[12.5px] text-primary placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 text-muted hover:text-primary"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
          </div>

          {/* List container */}
          <div className="max-h-[310px] overflow-y-auto p-1.5 space-y-3">
            {/* Premium Section */}
            {filtered.premium.length > 0 ? (
              <div>
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                  <span className="flex items-center gap-1">
                    <Sparkles size={11} /> Premium Clients (Hourly Intraday)
                  </span>
                  <Badge tone="neutral" className="text-[9px] py-0 px-1.5">
                    {filtered.premium.length}
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  {filtered.premium.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push(`/clients/${c.slug}`);
                      }}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-all hover:bg-surface-hover',
                        c.slug === active?.slug && 'bg-surface-active font-medium',
                      )}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-on-accent shadow-xs"
                        style={{ backgroundColor: c.brandColor ?? 'var(--color-accent)' }}
                      >
                        {c.name.charAt(0)}
                      </span>
                      <span className="flex-1 truncate text-[13px] text-primary group-hover:text-primary">
                        {c.name}
                      </span>
                      <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-500">
                        Hourly
                      </span>
                      {c.slug === active?.slug ? (
                        <Check size={14} className="text-accent shrink-0 ml-1" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Standard Section */}
            {filtered.standard.length > 0 ? (
              <div>
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <span className="flex items-center gap-1">
                    <TrendingUp size={11} /> Buzzohero Brands (GMV Brief)
                  </span>
                  <Badge tone="neutral" className="text-[9px] py-0 px-1.5">
                    {filtered.standard.length}
                  </Badge>
                </div>
                <div className="space-y-0.5">
                  {filtered.standard.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.push(`/clients/${c.slug}`);
                      }}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-all hover:bg-surface-hover',
                        c.slug === active?.slug && 'bg-surface-active font-medium',
                      )}
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-on-accent opacity-90 shadow-xs"
                        style={{ backgroundColor: c.brandColor ?? 'var(--color-accent)' }}
                      >
                        {c.name.charAt(0)}
                      </span>
                      <span className="flex-1 truncate text-[12.5px] text-secondary group-hover:text-primary">
                        {c.name}
                      </span>
                      <span className="rounded bg-surface px-1 py-0.5 text-[9px] font-medium text-muted">
                        GMV
                      </span>
                      {c.slug === active?.slug ? (
                        <Check size={14} className="text-accent shrink-0 ml-1" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {totalFiltered === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted">
                No Buzzohero brands match &ldquo;{search}&rdquo;
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
