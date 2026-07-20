'use client';

import { StatTile } from '@tempo/ui';
import type { KpiCard } from '@tempo/db';
import { formatKpi } from '@/lib/format-kpi';

const PAID_COLOR = 'var(--viz-series-paid)';
const ORGANIC_COLOR = 'var(--viz-series-organic)';

function KpiGroup({
  title,
  cards,
  color,
  currency,
  comparison,
}: {
  title: string;
  cards: KpiCard[];
  color: string;
  currency: string;
  comparison: string;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatTile
            key={card.key}
            label={card.label}
            value={formatKpi(card.key, card.value, currency)}
            delta={card.delta}
            goodDirection={card.goodDirection}
            sparkline={card.sparkline}
            color={color}
            comparison={comparison}
          />
        ))}
      </div>
    </section>
  );
}

export function KpiGrid({
  paidKpis,
  organicKpis,
  currency,
  comparison,
  showPaid,
  showOrganic,
}: {
  paidKpis: KpiCard[];
  organicKpis: KpiCard[];
  currency: string;
  comparison: string;
  showPaid: boolean;
  showOrganic: boolean;
}) {
  return (
    <div className="space-y-5">
      {showPaid ? (
        <KpiGroup title="Paid" cards={paidKpis} color={PAID_COLOR} currency={currency} comparison={comparison} />
      ) : null}
      {showOrganic ? (
        <KpiGroup
          title="Organic"
          cards={organicKpis}
          color={ORGANIC_COLOR}
          currency={currency}
          comparison={comparison}
        />
      ) : null}
    </div>
  );
}
