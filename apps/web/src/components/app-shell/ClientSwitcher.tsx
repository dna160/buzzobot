'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@tempo/ui';
import { trpc } from '@/trpc/client';

/** Dropdown to switch the active client; navigates to that client's dashboard. */
export function ClientSwitcher() {
  const router = useRouter();
  const params = useParams<{ slug?: string }>();
  const { data: clients } = trpc.clients.list.useQuery();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const active = clients?.find((c) => c.slug === params?.slug) ?? clients?.[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:border-border-strong"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-on-accent"
          style={{ backgroundColor: active?.brandColor ?? 'var(--color-accent)' }}
        >
          {active?.name?.charAt(0) ?? 'T'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-primary">
            {active?.name ?? 'Select client'}
          </span>
          <span className="block truncate text-[11px] text-muted">Client workspace</span>
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-muted" />
      </button>

      {open && clients ? (
        <div className="absolute left-0 right-0 top-full z-dropdown mt-1.5 overflow-hidden rounded-md border border-border bg-elevated p-1 shadow-popover">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(`/clients/${c.slug}`);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left transition-colors hover:bg-surface-hover',
              )}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-semibold text-on-accent"
                style={{ backgroundColor: c.brandColor ?? 'var(--color-accent)' }}
              >
                {c.name.charAt(0)}
              </span>
              <span className="flex-1 truncate text-[13px] text-primary">{c.name}</span>
              {c.slug === active?.slug ? <Check size={14} className="text-accent" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
