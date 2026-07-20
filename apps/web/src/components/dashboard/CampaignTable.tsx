'use client';

import { Badge, Table, THead, TBody, TR, TH, TD } from '@tempo/ui';
import type { CampaignRow } from '@tempo/db';
import { formatCurrencyCompact, formatPercent, formatRatio, type Currency } from '@tempo/core';

const OBJECTIVE_LABEL: Record<string, string> = {
  web_conversions: 'Conversions',
  traffic: 'Traffic',
  video_views: 'Video Views',
  lead_generation: 'Lead Gen',
  reach: 'Reach',
  engagement: 'Engagement',
  app_promotion: 'App',
  product_sales: 'Sales',
};

const statusTone = (s: string) => (s === 'active' ? 'success' : s === 'paused' ? 'warning' : 'neutral');

export function CampaignTable({ rows, currency }: { rows: CampaignRow[]; currency: string }) {
  const cur = currency as Currency;
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>Campaign</TH>
          <TH numeric>Spend</TH>
          <TH numeric>CTR</TH>
          <TH numeric>Conv.</TH>
          <TH numeric>CPA</TH>
          <TH numeric>ROAS</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD>
              <div className="flex items-center gap-2.5">
                <Badge tone={statusTone(r.status)} dot>
                  {OBJECTIVE_LABEL[r.objective] ?? r.objective}
                </Badge>
                <span className="max-w-[220px] truncate font-medium text-primary">{r.name}</span>
              </div>
            </TD>
            <TD numeric>{formatCurrencyCompact(r.spend, cur)}</TD>
            <TD numeric>{formatPercent(r.ctr, 2)}</TD>
            <TD numeric>{r.conversions.toLocaleString()}</TD>
            <TD numeric>{r.cpa > 0 ? formatCurrencyCompact(r.cpa, cur) : '—'}</TD>
            <TD numeric>
              <span className={r.roas >= 2 ? 'text-success' : r.roas > 0 ? 'text-primary' : 'text-muted'}>
                {r.roas > 0 ? formatRatio(r.roas) : '—'}
              </span>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
