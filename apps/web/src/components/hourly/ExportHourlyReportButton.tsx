'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@tempo/ui';

/**
 * Generates and downloads the client's intraday report as a PDF. The heavy
 * work (render + headless Chromium) happens server-side; this just triggers
 * the download and shows progress.
 *
 * Scoped to the currently selected date's trailing 7-day window (the same
 * "date" the dashboard's own picker resolves to) — exporting from a given day
 * means that day and the week behind it, never the account's entire ingested
 * history.
 */
export function ExportHourlyReportButton({
  slug,
  lang,
  date,
}: {
  slug: string;
  lang?: 'id' | 'en';
  /** The dashboard's currently selected/resolved date, e.g. "2026-07-31". */
  date?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const onClick = async () => {
    setState('loading');
    try {
      const params = new URLSearchParams();
      if (lang) params.set('lang', lang);
      if (date) params.set('date', date);
      const query = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(`/api/reports/${slug}${query}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Report request failed (${res.status})`);
      const blob = await res.blob();

      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `${slug}-tiktok-hourly.pdf`;

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
    <Button variant="primary" size="sm" onClick={onClick} disabled={state === 'loading'}>
      {state === 'loading' ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          Generating…
        </>
      ) : state === 'error' ? (
        'Retry export'
      ) : (
        <>
          <FileText size={14} />
          Export report
        </>
      )}
    </Button>
  );
}
