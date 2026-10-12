import pg from 'pg';

// Parse PostgreSQL DATE type as plain string to avoid local timezone offset shifting dates.
pg.types.setTypeParser(1082, (val: string) => val);

/** A day's totals for the metrics the Template Report's health-check/trend
 * sections need — all sourced from the single unpartitioned `tiktok_ads_campaign`
 * table (full history, no quarter-boundary UNION needed). */
export interface TemplateReportPeriodTotals {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoWatched6s: number;
  engagements: number;
  onsiteShopping: number; // orders
  totalOnsiteShoppingValue: number; // GMV
}

export interface TemplateReportCampaignRow {
  campaignId: string;
  campaignName: string;
  objectiveType: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  onsiteShopping: number;
  totalOnsiteShoppingValue: number;
}

export interface TemplateReportProductRow {
  campaignName: string;
  gmv: number;
  orders: number;
  roi: number | null;
}

/**
 * Cost/revenue/orders totals sourced EXCLUSIVELY from the GMV Max product
 * campaign tables (`tiktok_ads_gmv_max_product_campaign_*`) — deliberately
 * NOT `tiktok_ads_campaign` (TTAM/regular ads). The two are different
 * campaign delivery types with their own cost and revenue; blending them
 * (as `TemplateReportPeriodTotals.spend`/`totalOnsiteShoppingValue`
 * previously did, by mistake) understates or misattributes GMV Max's real
 * numbers. This is the sole source for the report's "Total Spend"/"Total
 * Revenue" KPIs and the §4 trend table.
 */
export interface TemplateReportGmvMaxTotals {
  cost: number;
  grossRevenue: number;
  orders: number;
}

/** One GMV Max product campaign's cost/revenue for the window — the per-source view behind the ROI breakdown table. */
export interface TemplateReportGmvMaxCampaignRow {
  campaignId: string;
  campaignName: string;
  cost: number;
  grossRevenue: number;
  orders: number;
}

export interface TemplateReportCreativeRow {
  adName: string;
  format: string;
  spend: number;
  ctr: number | null;
  roi: number | null;
}

export interface TemplateReportRawData {
  windowStart: string;
  windowEnd: string;
  priorStart: string;
  priorEnd: string;
  current: TemplateReportPeriodTotals;
  prior: TemplateReportPeriodTotals;
  /** GMV Max-exclusive cost/revenue/orders — the only source for the report's headline cost/revenue figures (never `current.spend`/`totalOnsiteShoppingValue`, which are TTAM). */
  currentGmvMax: TemplateReportGmvMaxTotals;
  priorGmvMax: TemplateReportGmvMaxTotals;
  campaigns: TemplateReportCampaignRow[]; // current-period, per campaign — drives funnel + benchmark tables
  /** Prior-period equivalent of `campaigns` — lets the "previous period" benchmark mode compute the same funnel split/CPA the current period gets. */
  priorCampaigns: TemplateReportCampaignRow[];
  topProducts: TemplateReportProductRow[]; // from GMV Max product campaigns, current period
  /** Every GMV Max product campaign with cost in the window (not just the top 4) — ROI breakdown input. */
  gmvMaxCampaigns: TemplateReportGmvMaxCampaignRow[];
  topCreatives: TemplateReportCreativeRow[]; // from ad-level table, current period
  /** Every real TikTok ad account id this report's numbers were pulled from — printed on the report so an AM can verify it against the real account. */
  tiktokAdAccountIds: string[];
}

const ZERO_TOTALS: TemplateReportPeriodTotals = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  reach: 0,
  videoWatched6s: 0,
  engagements: 0,
  onsiteShopping: 0,
  totalOnsiteShoppingValue: 0,
};

const num = (v: unknown): number => Number(v) || 0;

async function fetchPeriodTotals(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportPeriodTotals> {
  const { rows } = await pool.query<Record<string, string>>(
    `SELECT
       COALESCE(SUM(spend), 0) as spend,
       COALESCE(SUM(impressions), 0) as impressions,
       COALESCE(SUM(clicks), 0) as clicks,
       COALESCE(SUM(reach), 0) as reach,
       COALESCE(SUM(video_watched_6s), 0) as video_watched_6s,
       COALESCE(SUM(engagements), 0) as engagements,
       COALESCE(SUM(onsite_shopping), 0) as onsite_shopping,
       COALESCE(SUM(total_onsite_shopping_value), 0) as total_onsite_shopping_value
     FROM tiktok_ads_campaign
     WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3;`,
    [adAccountIds, start, end],
  );
  const r = rows[0];
  if (!r) return ZERO_TOTALS;
  return {
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    reach: num(r.reach),
    videoWatched6s: num(r.video_watched_6s),
    engagements: num(r.engagements),
    onsiteShopping: num(r.onsite_shopping),
    totalOnsiteShoppingValue: num(r.total_onsite_shopping_value),
  };
}

async function fetchCampaignRows(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportCampaignRow[]> {
  const { rows } = await pool.query<{
    campaign_id: string;
    campaign_name: string;
    objective_type: string | null;
    spend: string;
    impressions: string;
    clicks: string;
    onsite_shopping: string;
    total_onsite_shopping_value: string;
  }>(
    `SELECT
       campaign_id,
       MAX(NULLIF(campaign_name, '')) as campaign_name,
       MAX(objective_type) as objective_type,
       SUM(COALESCE(spend, 0)) as spend,
       SUM(COALESCE(impressions, 0)) as impressions,
       SUM(COALESCE(clicks, 0)) as clicks,
       SUM(COALESCE(onsite_shopping, 0)) as onsite_shopping,
       SUM(COALESCE(total_onsite_shopping_value, 0)) as total_onsite_shopping_value
     FROM tiktok_ads_campaign
     WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3 AND spend > 0
     GROUP BY campaign_id
     ORDER BY spend DESC;`,
    [adAccountIds, start, end],
  );
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaignName: r.campaign_name ?? r.campaign_id,
    objectiveType: r.objective_type,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    onsiteShopping: num(r.onsite_shopping),
    totalOnsiteShoppingValue: num(r.total_onsite_shopping_value),
  }));
}

/** Quarterly partitions a [start, end) window spans, e.g. 2026-07-01..2026-08-27 -> [y2026q3]. */
function quartersInRange(start: string, end: string): string[] {
  const out = new Set<string>();
  const cur = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cur < endDate) {
    const year = cur.getUTCFullYear();
    const quarter = Math.floor(cur.getUTCMonth() / 3) + 1;
    out.add(`y${year}q${quarter}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return [...out];
}

/** Runs the same aggregate query across every quarterly partition the window
 * touches and concatenates the rows — the GMV Max product and ad-level tables
 * are quarter-partitioned, unlike `tiktok_ads_campaign`. */
async function queryAcrossQuarters<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  tablePrefix: string,
  start: string,
  end: string,
  buildQuery: (table: string) => string,
  params: unknown[],
): Promise<T[]> {
  const quarters = quartersInRange(start, end);
  const out: T[] = [];
  for (const q of quarters) {
    const table = `${tablePrefix}_${q}`;
    try {
      const { rows } = await pool.query<T>(buildQuery(table), params);
      out.push(...rows);
    } catch (err) {
      // A quarter with no partition yet (future) or already dropped (very old) —
      // skip rather than fail the whole report.
      console.warn(`[template-report] skipping ${table}:`, (err as Error).message);
    }
  }
  return out;
}


const ZERO_GMV_MAX: TemplateReportGmvMaxTotals = { cost: 0, grossRevenue: 0, orders: 0 };

/** Account-level GMV Max totals for a period — the ONLY source for the report's headline cost/revenue figures. */
async function fetchGmvMaxTotals(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportGmvMaxTotals> {
  const rows = await queryAcrossQuarters<{ cost: string; gross_revenue: string; orders: string }>(
    pool,
    'tiktok_ads_gmv_max_product_campaign',
    start,
    end,
    (table) => `
      SELECT
        COALESCE(SUM(cost), 0) as cost,
        COALESCE(SUM(gross_revenue), 0) as gross_revenue,
        COALESCE(SUM(orders), 0) as orders
      FROM ${table}
      WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3;`,
    [adAccountIds, start, end],
  );
  if (rows.length === 0) return ZERO_GMV_MAX;
  return rows.reduce(
    (acc, r) => ({
      cost: acc.cost + num(r.cost),
      grossRevenue: acc.grossRevenue + num(r.gross_revenue),
      orders: acc.orders + num(r.orders),
    }),
    { ...ZERO_GMV_MAX },
  );
}

/** Every GMV Max product campaign with spend, merged across the quarter partitions the window touches. */
async function fetchGmvMaxCampaigns(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportGmvMaxCampaignRow[]> {
  const rows = await queryAcrossQuarters<{
    campaign_id: string;
    campaign_name: string | null;
    cost: string;
    gross_revenue: string;
    orders: string;
  }>(
    pool,
    'tiktok_ads_gmv_max_product_campaign',
    start,
    end,
    (table) => `
      SELECT
        campaign_id,
        MAX(NULLIF(campaign_name, '')) as campaign_name,
        SUM(COALESCE(cost, 0)) as cost,
        SUM(COALESCE(gross_revenue, 0)) as gross_revenue,
        SUM(COALESCE(orders, 0)) as orders
      FROM ${table}
      WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3
      GROUP BY campaign_id
      HAVING SUM(COALESCE(cost, 0)) > 0;`,
    [adAccountIds, start, end],
  );
  const merged = new Map<string, TemplateReportGmvMaxCampaignRow>();
  for (const r of rows) {
    const key = String(r.campaign_id);
    const prev = merged.get(key);
    merged.set(key, {
      campaignId: key,
      campaignName: prev?.campaignName ?? r.campaign_name ?? key,
      cost: (prev?.cost ?? 0) + num(r.cost),
      grossRevenue: (prev?.grossRevenue ?? 0) + num(r.gross_revenue),
      orders: (prev?.orders ?? 0) + num(r.orders),
    });
  }
  return [...merged.values()].sort((a, b) => b.cost - a.cost);
}

/** GMV Max-exclusive creative performance — tried first; `tiktok_ads_ads` (TTAM) is only a fallback when this has no rows. */
async function fetchGmvMaxCreatives(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportCreativeRow[]> {
  const rows = await queryAcrossQuarters<{
    product_name: string;
    cost: string;
    ad_click_rate: string | null;
    roi: string | null;
  }>(
    pool,
    'tiktok_ads_gmv_max_product_creative',
    start,
    end,
    (table) => `
      SELECT
        MAX(NULLIF(product_name, '')) as product_name,
        SUM(COALESCE(cost, 0)) as cost,
        AVG(ad_click_rate) as ad_click_rate,
        AVG(roi) as roi
      FROM ${table}
      WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3 AND cost > 0
      GROUP BY item_id
      ORDER BY cost DESC
      LIMIT 4;`,
    [adAccountIds, start, end],
  );
  return rows
    .map((r) => ({
      adName: r.product_name ?? 'Unnamed creative',
      format: 'GMV Max Native',
      spend: num(r.cost),
      ctr: r.ad_click_rate === null ? null : num(r.ad_click_rate),
      roi: r.roi === null ? null : num(r.roi),
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 4);
}

/** TTAM (regular ads) creative performance — the fallback when GMV Max has no creative-level data for this account/window. */
async function fetchTtamCreatives(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportCreativeRow[]> {
  const rows = await queryAcrossQuarters<{
    ad_name: string;
    image_mode: string | null;
    spend: string;
    ctr: string | null;
    total_onsite_shopping_value: string;
  }>(
    pool,
    'tiktok_ads_ads',
    start,
    end,
    (table) => `
      SELECT
        MAX(NULLIF(ad_name, '')) as ad_name,
        MAX(image_mode) as image_mode,
        SUM(COALESCE(spend, 0)) as spend,
        -- ctr is derived from the counts: the table's own column is stored in percent units
        -- (1.1 = 1.1%) and averaging daily percentages ignores volume.
        SUM(COALESCE(clicks, 0))::float8 / NULLIF(SUM(COALESCE(impressions, 0)), 0) as ctr,
        SUM(COALESCE(total_onsite_shopping_value, 0)) as total_onsite_shopping_value
      FROM ${table}
      WHERE ad_account_id = ANY($1) AND date >= $2 AND date < $3 AND spend > 0
      GROUP BY ad_id
      ORDER BY spend DESC
      LIMIT 4;`,
    [adAccountIds, start, end],
  );
  return rows
    .map((r) => ({
      adName: r.ad_name ?? 'Unnamed creative',
      format: r.image_mode ?? '—',
      spend: num(r.spend),
      ctr: r.ctr === null ? null : num(r.ctr),
      roi: num(r.total_onsite_shopping_value) > 0 && num(r.spend) > 0 ? num(r.total_onsite_shopping_value) / num(r.spend) : null,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 4);
}

/** GMV Max creative data first; TTAM only when GMV Max has none for this account/window. */
async function fetchTopCreatives(
  pool: pg.Pool,
  adAccountIds: string[],
  start: string,
  end: string,
): Promise<TemplateReportCreativeRow[]> {
  const gmvMax = await fetchGmvMaxCreatives(pool, adAccountIds, start, end);
  if (gmvMax.length > 0) return gmvMax;
  return fetchTtamCreatives(pool, adAccountIds, start, end);
}

/**
 * Connects to the source TikTok database (env `DB_HOST`/`DB_PORT`/`DB_NAME`/
 * `DB_USER`/`DB_PASSWORD` — the same real Postgres `discoverPostgresBrands`
 * and `syncStandardBrandToDomain` already read from). Callers that don't
 * depend on `pg` directly (e.g. `apps/web`) get a connected pool without
 * adding the dependency themselves.
 */
export function createSourcePool(): pg.Pool | null {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT);
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  if (!host || !database || !user) return null;
  return new pg.Pool({ host, port, database, user, password });
}

/** ISO date `days` days before `end` (exclusive end convention: [start, end)). */
function daysBefore(end: string, days: number): string {
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates, [start, end) — e.g. '2026-08-01' to '2026-09-01' -> 31. */
function daysBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((e - s) / 86_400_000);
}

/**
 * Fetches everything the Template Report needs for a client's TikTok ad
 * account(s) — plural because a hand-curated Premium brand like Kanzler is a
 * rollup of several real accounts, not one — directly from the real source
 * tables. Same "live query, never pre-materialize" pattern
 * `syncStandardBrandToDomain` already uses, richer (VTR/reach/objective_type/
 * product/creative breakdowns that `paid_daily_metrics` doesn't carry).
 *
 * `windowStart`/`windowEnd` are both optional and both use the exclusive-end
 * convention ([start, end)) internally — the route layer converts a human's
 * inclusive "1 Aug – 31 Aug" into this before calling in. Omitting both
 * defaults to the trailing 30 days ending "now", unchanged from before this
 * became configurable. The prior comparison period is always exactly as long
 * as the chosen window and immediately precedes it — a 60-day window gets a
 * 60-day prior period, not a fixed 30, so the comparison is always apples to
 * apples regardless of how wide a range was requested.
 */
export async function fetchTemplateReportRawData(
  pool: pg.Pool,
  {
    tiktokAdAccountIds,
    windowStart: explicitStart,
    windowEnd,
  }: { tiktokAdAccountIds: string[]; windowStart?: string; windowEnd?: string },
): Promise<TemplateReportRawData> {
  const end = windowEnd ?? new Date().toISOString().slice(0, 10);
  const windowStart = explicitStart ?? daysBefore(end, 30);
  const windowDays = daysBetween(windowStart, end);
  const priorEnd = windowStart;
  const priorStart = daysBefore(priorEnd, windowDays);

  const [current, prior, currentGmvMax, priorGmvMax, campaigns, priorCampaigns, gmvMaxCampaigns, topCreatives] =
    await Promise.all([
      fetchPeriodTotals(pool, tiktokAdAccountIds, windowStart, end),
      fetchPeriodTotals(pool, tiktokAdAccountIds, priorStart, priorEnd),
      fetchGmvMaxTotals(pool, tiktokAdAccountIds, windowStart, end),
      fetchGmvMaxTotals(pool, tiktokAdAccountIds, priorStart, priorEnd),
      fetchCampaignRows(pool, tiktokAdAccountIds, windowStart, end),
      fetchCampaignRows(pool, tiktokAdAccountIds, priorStart, priorEnd),
      fetchGmvMaxCampaigns(pool, tiktokAdAccountIds, windowStart, end),
      fetchTopCreatives(pool, tiktokAdAccountIds, windowStart, end),
    ]);

  // Top products come from the same per-campaign rows as the ROI breakdown, so
  // a campaign shows one ROI (revenue ÷ cost) everywhere in the report — not a
  // second, unweighted average of daily ROIs — and a window that crosses a
  // quarter boundary can't list one campaign twice.
  const topProducts: TemplateReportProductRow[] = [...gmvMaxCampaigns]
    .sort((a, b) => b.grossRevenue - a.grossRevenue)
    .slice(0, 4)
    .map((c) => ({
      campaignName: c.campaignName,
      gmv: c.grossRevenue,
      orders: c.orders,
      roi: c.cost > 0 ? c.grossRevenue / c.cost : null,
    }));

  return {
    windowStart,
    windowEnd: end,
    priorStart,
    priorEnd,
    current,
    prior,
    currentGmvMax,
    priorGmvMax,
    campaigns,
    priorCampaigns,
    topProducts,
    gmvMaxCampaigns,
    topCreatives,
    tiktokAdAccountIds,
  };
}
