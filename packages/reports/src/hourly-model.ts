import type {
  CampaignBreakdown,
  ClientSummary,
  Coverage,
  Database,
  HourPoint,
  HourlyDashboardData,
  PacingPoint,
  Totals,
} from '@tempo/db';
import { getHourlyDashboard, listHourlyDates } from '@tempo/db';
import { DEFAULT_LOCALE, getCopy, type Locale, type ReportCopy } from './i18n.js';
import { buildHourlyInsights, type HourlyInsights } from './hourly-insights.js';
import { generateNarrative, type NarrativeResult } from './narrative/generate.js';
import type { NarrativeConfig } from './narrative/provider.js';

/**
 * The model an intraday report renders from.
 *
 * Deliberately carries no ROAS, conversion or organic fields: a TikTok Ads
 * "daily in hourly" export contains none of them, and the previous daily
 * report presented those absences as real zeros. Anything not in the source is
 * simply not in this model.
 */
export interface HourlyReportDay {
  date: string;
  coverage: Coverage;
  /** Day totals, including any bucket that absorbs earlier hours. */
  totals: Totals;
  /** True hours only. */
  hours: HourPoint[];
  pacing: PacingPoint[];
}

/** Everything in the model except the narrative derived from it. */
export interface HourlyReportBase {
  locale: Locale;
  copy: ReportCopy;
  client: ClientSummary;
  /** Every date in the export, oldest first. */
  days: HourlyReportDay[];
  /**
   * The day the charts and the narrative both describe: the one with the most
   * true hours, so the intraday shape is representative. Deliberately not
   * "most recent" — a day synced only to 11:00 would give a pacing curve that
   * stops mid-morning while the text described a full day.
   */
  focus: HourlyReportDay;
  /** Campaign/adgroup breakdown aggregated across the whole window. */
  campaigns: CampaignBreakdown[];
  /** Totals across every day in the window. */
  windowTotals: Totals;
  /** Count of true hours across the window. */
  totalHours: number;
  /**
   * Day-over-day movement for the KPI row, computed over only the hours the
   * two days share. Null when there is no prior day to compare against.
   */
  comparison: {
    label: string;
    deltas: {
      impressions: number | null;
      reach: number | null;
      vtr6s: number | null;
      vtr15s: number | null;
      spend: number | null;
      clicks: number | null;
      ctr: number | null;
      cpc: number | null;
      cpm: number | null;
    };
  } | null;
  periodLabel: string;
  generatedLabel: string;
}

export interface HourlyReportModel extends HourlyReportBase {
  insights: HourlyInsights;
  /**
   * The report narrative — LLM-written when a provider is configured, and the
   * deterministic analysis otherwise. Both paths produce the same shape, so
   * the renderer never branches on which one ran.
   */
  narrative: NarrativeResult;
}

const fmtDay = (iso: string, copy: ReportCopy): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const mon = copy.months[(m ?? 1) - 1];
  return copy.dayFirst ? `${d} ${mon} ${y}` : `${mon} ${d}, ${y}`;
};

const fmtDayShort = (iso: string, copy: ReportCopy): string => {
  const [, m, d] = iso.split('-').map(Number);
  const mon = copy.months[(m ?? 1) - 1];
  return copy.dayFirst ? `${d} ${mon}` : `${mon} ${d}`;
};

const fmtGenerated = (at: Date, copy: ReportCopy): string => {
  const [date, time] = at.toISOString().split('T');
  return `${copy.generatedPrefix} ${fmtDay(date!, copy)} · ${time!.slice(0, 5)} UTC`;
};

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Pool a set of totals. Ratios are recomputed from the sums, never averaged. */
function poolTotals(all: readonly Totals[]): Totals {
  const acc = {
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    videoViews: 0,
    videoWatched6s: 0,
    engagedView15s: 0,
    engagements: 0,
  };
  for (const t of all) {
    acc.spend += t.spend;
    acc.impressions += t.impressions;
    acc.clicks += t.clicks;
    acc.reach += t.reach;
    acc.videoViews += t.videoViews;
    acc.videoWatched6s += t.videoWatched6s;
    acc.engagedView15s += t.engagedView15s;
    acc.engagements += t.engagements;
  }
  return {
    ...acc,
    // View-through rates lead; cost ratios kept for context (see hourly.ts).
    vtr6s: ratio(acc.videoWatched6s, acc.impressions),
    vtr15s: ratio(acc.engagedView15s, acc.impressions),
    frequency: ratio(acc.impressions, acc.reach),
    ctr: ratio(acc.clicks, acc.impressions),
    cpc: ratio(acc.spend, acc.clicks),
    cpm: acc.impressions > 0 ? (acc.spend / acc.impressions) * 1000 : null,
    cpv: ratio(acc.spend, acc.videoViews),
  };
}

/** Merge per-day campaign breakdowns into window-level ones. */
function mergeCampaigns(perDay: readonly HourlyDashboardData[]): CampaignBreakdown[] {
  const byId = new Map<string, { base: CampaignBreakdown; totals: Totals[]; ag: Map<string, { name: string; totals: Totals[] }> }>();

  for (const day of perDay) {
    for (const c of day.campaigns) {
      let entry = byId.get(c.id);
      if (!entry) {
        entry = { base: c, totals: [], ag: new Map() };
        byId.set(c.id, entry);
      }
      entry.totals.push(c.totals);
      for (const a of c.adgroups) {
        const cur = entry.ag.get(a.id) ?? { name: a.name, totals: [] };
        cur.totals.push(a.totals);
        entry.ag.set(a.id, cur);
      }
    }
  }

  return [...byId.values()]
    .map(({ base, totals, ag }) => ({
      id: base.id,
      name: base.name,
      objective: base.objective,
      totals: poolTotals(totals),
      // Hour series belong to a single day; the window view is totals-only.
      hours: [],
      adgroups: [...ag.entries()]
        .map(([id, v]) => ({ id, name: v.name, totals: poolTotals(v.totals), hours: [] }))
        .sort((a, b) => b.totals.spend - a.totals.spend),
    }))
    .sort((a, b) => b.totals.spend - a.totals.spend);
}

/**
 * Assemble an intraday report across every date the export holds. Reuses the
 * same read-model the dashboard renders, so the report cannot disagree with
 * what is on screen.
 */
export async function buildHourlyReport(
  db: Database,
  client: ClientSummary,
  opts: {
    generatedAt: Date;
    locale?: Locale;
    /**
     * Overrides the environment-derived narrative config, field by field. The
     * API layer passes the operator's saved Settings here so a UI-configured
     * provider wins over `.env` without the report code reading the database.
     */
    narrativeConfig?: Partial<NarrativeConfig>;
  },
): Promise<HourlyReportModel | null> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const copy = getCopy(locale);

  const dates = await listHourlyDates(db, client.id);
  if (dates.length === 0) return null;

  const perDay: HourlyDashboardData[] = [];
  for (const date of dates) {
    const d = await getHourlyDashboard(db, client, date);
    if (d) perDay.push(d);
  }
  if (perDay.length === 0) return null;

  const days: HourlyReportDay[] = perDay.map((d) => ({
    date: d.date,
    coverage: d.coverage,
    totals: d.totals,
    hours: d.hours,
    pacing: d.pacing,
  }));

  // Most complete day wins; ties break toward the more recent one.
  const focus = [...days].sort(
    (a, b) => b.hours.length - a.hours.length || b.date.localeCompare(a.date),
  )[0]!;
  const windowTotals = poolTotals(days.map((d) => d.totals));
  const totalHours = days.reduce((n, d) => n + d.hours.length, 0);
  const campaigns = mergeCampaigns(perDay);

  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const periodLabel =
    first === last
      ? fmtDay(first, copy)
      : `${fmtDay(first, copy)} – ${fmtDay(last, copy)} (${dates.length} ${copy.daysWord})`;

  // Day-over-day for the KPI row. Taken from the read-model so the
  // matched-hours basis is identical to the dashboard's, and labelled with that
  // basis so a whole-window value is never read as having a whole-day delta.
  const latest = perDay[perDay.length - 1];
  const c = latest?.comparison ?? null;
  const comparison = c
    ? {
        label: `${c.hoursMatched.length}h ${fmtDayShort(latest!.date, copy)} vs ${fmtDayShort(c.date, copy)}`,
        deltas: c.deltas,
      }
    : null;

  const base: HourlyReportBase = {
    locale,
    copy,
    client,
    days,
    focus,
    campaigns,
    windowTotals,
    totalHours,
    comparison,
    periodLabel,
    generatedLabel: fmtGenerated(opts.generatedAt, copy),
  };

  // The narrative is generated last: it reads the finished fact base, and the
  // deterministic analysis inside it doubles as the fallback.
  const narrative = await generateNarrative(base, locale, opts.narrativeConfig);

  return { ...base, insights: buildHourlyInsights(base, perDay), narrative };
}
