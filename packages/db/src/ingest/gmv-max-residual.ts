/**
 * GMV Max spend that the campaign-level warehouse table never reports.
 *
 * Tempo books GMV Max from `tiktok_ads_gmv_max_product_campaign`, one row per
 * campaign-day. For some advertisers that table is simply empty while TikTok's
 * advertiser-level TT_SHOP report — which the portal stores as
 * `tiktok_ads_analytics.gmv_max_cost` — carries the real spend. BARDI's 28 days
 * to 10 Oct 2026 held Rp37.5M of GMV Max in analytics and nothing in the
 * campaign table; Kalibre's held Rp152.0M and nothing, so Kalibre rendered as an
 * empty client. Where both sources have the day they agree to within 0.01%
 * (Evedaily Rp822.39M vs Rp822.34M), so the campaign table stays the primary
 * source and only the remainder is booked from analytics.
 *
 * The remainder lands on one synthetic campaign per ad account rather than being
 * spread over real campaigns — analytics has no campaign breakdown, and
 * inventing one would put numbers on campaigns that never earned them.
 */

/** Campaign `externalId` that carries an ad account's unattributed GMV Max spend. */
export const GMV_MAX_ACCOUNT_TOTAL_PREFIX = 'gmv-max-account-total:';

export const gmvMaxAccountTotalExternalId = (adAccountId: string): string =>
  `${GMV_MAX_ACCOUNT_TOTAL_PREFIX}${adAccountId}`;

export const GMV_MAX_ACCOUNT_TOTAL_NAME = 'GMV Max (account total, no campaign breakdown)';

export interface AnalyticsGmvMaxDay {
  adAccountId: string;
  date: string;
  gmvMaxCost: number;
  currency: string;
}

export interface CampaignGmvMaxDay {
  adAccountId: string;
  date: string;
  cost: number;
}

export interface GmvMaxResidualDay {
  adAccountId: string;
  date: string;
  spend: number;
}

export interface GmvMaxResidualOptions {
  /** A remainder at or below this share of the day's analytics figure is reporting noise. */
  relativeTolerance?: number;
  /** …or at or below this absolute amount (account currency). */
  absoluteTolerance?: number;
}

/**
 * Per ad-account day: analytics GMV Max minus what the campaign table already
 * reports for that day, kept only where the gap is real.
 *
 * USD rows are skipped. Discovered clients are IDR, Tempo does no FX, and the
 * portal's own Cost leaves USD out of Rupiah totals the same way.
 */
export function computeGmvMaxResidual(
  analytics: readonly AnalyticsGmvMaxDay[],
  campaign: readonly CampaignGmvMaxDay[],
  { relativeTolerance = 0.01, absoluteTolerance = 1000 }: GmvMaxResidualOptions = {},
): GmvMaxResidualDay[] {
  const key = (adAccountId: string, date: string) => `${adAccountId}|${date}`;
  const booked = new Map<string, number>();
  for (const c of campaign) {
    const k = key(c.adAccountId, c.date);
    booked.set(k, (booked.get(k) ?? 0) + c.cost);
  }

  const out: GmvMaxResidualDay[] = [];
  for (const a of analytics) {
    if (a.currency.trim().toUpperCase() === 'USD') continue;
    const remainder = a.gmvMaxCost - (booked.get(key(a.adAccountId, a.date)) ?? 0);
    if (remainder <= absoluteTolerance || remainder <= a.gmvMaxCost * relativeTolerance) continue;
    out.push({ adAccountId: a.adAccountId, date: a.date, spend: remainder });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.adAccountId.localeCompare(y.adAccountId));
}
