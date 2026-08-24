'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@tempo/ui';

const OBJECTIVE_LABEL = {
  awareness: 'Awareness Brief',
  gmv: 'GMV Brief',
  install: 'Install Brief',
} as const;

export type BriefObjective = keyof typeof OBJECTIVE_LABEL;

/**
 * Generates and downloads one of the three objective-specific Brief Decks
 * (Awareness / GMV / Install) as a 16:9 PDF, via
 * `/api/reports/:slug/brief/:objective`.
 *
 * Since M7 this is the only export on the intraday view: the hourly report
 * document is gone (K3) and `/api/reports/:slug` is a deprecated alias that
 * redirects here anyway (K5). `primary` marks the deck for the client's own
 * north star — the one an AM actually sends.
 *
 * Defaults to a trailing 7-day window ending on the dashboard's currently
 * selected date.
 */
export function ExportDailyBriefButton({
  slug,
  objective,
  lang,
  date,
  primary = false,
}: {
  slug: string;
  objective: BriefObjective;
  lang?: 'id' | 'en';
  date?: string;
  /** The client's north-star deck, given visual weight over the others. */
  primary?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const onClick = async () => {
    setState('loading');
    try {
      const params = new URLSearchParams();
      if (lang) params.set('lang', lang);
      if (date) params.set('date', date);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(`/api/reports/${slug}/brief/${objective}${query}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Brief request failed (${res.status})`);
      const blob = await res.blob();

      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `${slug}-tiktok-${objective}-brief.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState('idle');
    } catch (err) {
      console.error(err);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      onClick={onClick}
      disabled={state === 'loading'}
    >
      {state === 'loading' ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          Generating…
        </>
      ) : state === 'error' ? (
        'Retry'
      ) : (
        <>
          <FileText size={14} />
          {OBJECTIVE_LABEL[objective]}
        </>
      )}
    </Button>
  );
}
