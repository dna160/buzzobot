'use client';

import { ExternalLink } from 'lucide-react';
import { Table, THead, TBody, TR, TH, TD } from '@tempo/ui';
import type { VideoRow } from '@tempo/db';
import { formatDuration, formatNumberCompact, formatPercent } from '@tempo/core';

export function TopVideosTable({ rows }: { rows: VideoRow[] }) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>Content</TH>
          <TH numeric>Views</TH>
          <TH numeric>Eng. Rate</TH>
          <TH numeric>Avg Watch</TH>
          <TH numeric>Shares</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r, i) => (
          <TR key={r.id}>
            <TD>
              <div className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-right font-mono text-[12px] text-muted">{i + 1}</span>
                <span className="max-w-[280px] truncate font-medium text-primary">{r.caption}</span>
                {r.shareUrl ? (
                  <a
                    href={r.shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted transition-colors hover:text-accent"
                    aria-label="Open on TikTok"
                  >
                    <ExternalLink size={13} />
                  </a>
                ) : null}
              </div>
            </TD>
            <TD numeric>{formatNumberCompact(r.views)}</TD>
            <TD numeric>{formatPercent(r.engagementRate, 1)}</TD>
            <TD numeric>{formatDuration(r.avgWatchTimeSec)}</TD>
            <TD numeric>{formatNumberCompact(r.shares)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
