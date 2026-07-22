'use client';

import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Sparkline, TBody, TD, TH, THead, TR, Table, cn } from '@tempo/ui';
import type { CampaignBreakdown } from '@tempo/db';
import {
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  type Currency,
} from '@tempo/core';
import { orNa } from '@/lib/format-kpi';

/**
 * Campaigns for the selected date, expandable to their adgroups. The sparkline
 * is the campaign's true-hour spend curve, so the shape of the day is legible
 * without opening a chart.
 */
export function HourlyCampaignTable({
  campaigns,
  currency,
}: {
  campaigns: CampaignBreakdown[];
  currency: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const cur = currency as Currency;
  // Sub-unit precision is noise for IDR; round before formatting.
  const money = (v: number) => formatCurrencyCompact(Math.round(v), cur);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Table>
      <THead>
        <TR>
          <TH>Campaign</TH>
          <TH numeric>Spend</TH>
          <TH numeric>Impressions</TH>
          <TH numeric>Clicks</TH>
          <TH numeric>CTR</TH>
          <TH numeric>CPC</TH>
          <TH numeric>CPM</TH>
          <TH numeric>Hourly shape</TH>
        </TR>
      </THead>
      <TBody>
        {campaigns.map((c) => {
          const isOpen = open.has(c.id);
          return (
            <Fragment key={c.id}>
              <TR>
                <TD>
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    aria-expanded={isOpen}
                    className="flex max-w-[380px] items-center gap-1.5 text-left font-medium text-primary hover:text-accent"
                  >
                    <ChevronRight
                      size={13}
                      className={cn('shrink-0 transition-transform', isOpen && 'rotate-90')}
                    />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-1 shrink-0 text-[11px] font-normal text-muted">
                      {c.adgroups.length} adgroup{c.adgroups.length === 1 ? '' : 's'}
                    </span>
                  </button>
                </TD>
                <TD numeric>{money(c.totals.spend)}</TD>
                <TD numeric>{formatNumberCompact(c.totals.impressions)}</TD>
                <TD numeric>{formatNumberCompact(c.totals.clicks)}</TD>
                <TD numeric>{orNa(c.totals.ctr, (v) => formatPercent(v))}</TD>
                <TD numeric>{orNa(c.totals.cpc, money)}</TD>
                <TD numeric>{orNa(c.totals.cpm, money)}</TD>
                <TD numeric>
                  <div className="flex justify-end">
                    <Sparkline data={c.hours.map((h) => h.spend)} width={72} height={20} />
                  </div>
                </TD>
              </TR>

              {isOpen
                ? c.adgroups.map((a) => (
                    <TR key={a.id} className="bg-subtle/40">
                      <TD>
                        <span className="flex max-w-[380px] items-center gap-2 pl-[22px] text-[13px] text-secondary">
                          <span className="shrink-0 text-muted">└</span>
                          <span className="truncate">{a.name}</span>
                        </span>
                      </TD>
                      <TD numeric>{money(a.totals.spend)}</TD>
                      <TD numeric>{formatNumberCompact(a.totals.impressions)}</TD>
                      <TD numeric>{formatNumberCompact(a.totals.clicks)}</TD>
                      <TD numeric>{orNa(a.totals.ctr, (v) => formatPercent(v))}</TD>
                      <TD numeric>{orNa(a.totals.cpc, money)}</TD>
                      <TD numeric>{orNa(a.totals.cpm, money)}</TD>
                      <TD numeric>
                        <div className="flex justify-end">
                          <Sparkline data={a.hours.map((h) => h.spend)} width={72} height={20} />
                        </div>
                      </TD>
                    </TR>
                  ))
                : null}
            </Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}
