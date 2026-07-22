'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@tempo/ui';

/**
 * Generates and downloads the client's intraday report as a PDF. The heavy
 * work (render + headless Chromium) happens server-side; this just triggers
 * the download and shows progress.
 *
 * The report covers every ingested date rather than a selected one, so it does
 * not take the view's date — an export that silently reported only the day you
 * happened to be looking at would be easy to misread.
 */
export function ExportHourlyReportButton({ slug, lang }: { slug: string; lang?: 'id' | 'en' }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const onClick = async () => {
    setState('loading');
    try {
      const query = lang ? `?lang=${lang}` : '';
      const res = await fetch(`/api/reports/${slug}${query}`);
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
