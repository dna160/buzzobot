'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@tempo/ui';
import type { RangePresetValue } from '@/lib/constants';

/**
 * Generates and downloads the client's TikTok performance report as a PDF for
 * the currently-selected window. The heavy work (render + headless Chromium)
 * happens server-side; this just triggers the download and shows progress.
 */
export function ExportReportButton({
  slug,
  preset,
}: {
  slug: string;
  preset: RangePresetValue;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const onClick = async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/reports/${slug}?preset=${preset}`);
      if (!res.ok) throw new Error(`Report request failed (${res.status})`);
      const blob = await res.blob();

      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `${slug}-tiktok-report.pdf`;

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
