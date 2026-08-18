import pg from 'pg';
import { EntityStatus, type DataSurface, type DateRange } from '@tempo/core';
import type {
  AccountDTO,
  AdgroupDTO,
  CampaignDTO,
  OrganicMetricDTO,
  PaidHourlyMetricDTO,
  PaidMetricDTO,
  TenantDTO,
  TikTokDataProvider,
  VideoDTO,
} from '../types.js';
import { inferObjective } from '../csv/provider.js';
import {
  pivotHourlyRows,
  type HourBucket,
  type ParsedExport,
  type RawExportRow,
} from '../csv/parse.js';

/**
 * Serves a real brand's data from a live-polled Postgres table, in the same
 * "daily in hourly" wire format the CSV export uses (see csv/parse.ts) — the
 * sanitizer daemon (`packages/db/src/scripts/scheduler.ts`) keeps this table
 * current from the brand's own TikTok export pipeline. Paid-only, like the CSV
 * provider: this shape carries no organic content data.
 */
export interface PostgresProviderOptions {
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  /** The brand's table, e.g. "cimory_daily_performance". Never user input. */
  table: string;
  advertiserId: string;
  tenant: TenantDTO;
  /** Raw metric name that feeds the generic `conversions` field, e.g. "onsite_shopping" or "app_install". */
  conversionMetric?: string;
  /** Raw metric name that feeds `conversionValue` (revenue), when the source reports one. */
  conversionValueMetric?: string;
}

/**
 * Only these metric rows carry a value this app understands (see
 * csv/parse.ts's METRIC_FIELDS). The table carries dozens of others (ratios,
 * skan_*, live_*, etc.) that would otherwise multiply the row count fetched
 * for no benefit.
 */
const KNOWN_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'reach',
  'video_views_p100',
  'video_watched_6s',
  'engaged_view_15s',
  'engagements',
  'likes',
  'comments',
  'shares',
  'follows',
  'profile_visits',
];

const HOUR_COLUMNS = Array.from({ length: 25 }, (_, h) => `h${String(h).padStart(2, '0')}`);

/** A table name is config, not user input, but this still guards against a typo like `foo; drop table x`. */
function assertSafeIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid Postgres table name in TIKTOK_PG_TABLE: "${name}"`);
  }
}

// Parse PostgreSQL DATE type (OID 1082) as plain string to avoid local timezone offset shifting dates
pg.types.setTypeParser(1082, (val: string) => val);

const toIsoDate = (v: unknown): string => {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const year = v.getFullYear();
    const month = String(v.getMonth() + 1).padStart(2, '0');
    const day = String(v.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(v).slice(0, 10);
};

export class PostgresTikTokProvider implements TikTokDataProvider {
  readonly name = 'postgres-live';
  readonly surfaces: readonly DataSurface[] = ['paid'];

  private readonly pool: pg.Pool;
  private loaded: Promise<ParsedExport> | null = null;

  constructor(private readonly opts: PostgresProviderOptions) {
    assertSafeIdentifier(opts.table);
    this.pool = new pg.Pool(opts.connection);
  }

  /**
   * Loads and pivots the whole known-metrics window once per process, then
   * serves every provider method from that in-memory result — matching the
   * CSV provider's own lazy-load-once shape, just backed by a query instead of
   * a file read.
   */
  private data(): Promise<ParsedExport> {
    if (!this.loaded) this.loaded = this.load();
    return this.loaded;
  }

  private async load(): Promise<ParsedExport> {
    const extraFields: Record<string, keyof HourBucket> = {};
    if (this.opts.conversionMetric) extraFields[this.opts.conversionMetric] = 'conversions';
    if (this.opts.conversionValueMetric) {
      extraFields[this.opts.conversionValueMetric] = 'conversionValue';
    }
    // The brand's own conversion metric names must be fetched too — they are
    // not in the fixed KNOWN_METRICS list because which metric means
    // "conversion" differs per brand (see conversionMetric/conversionValueMetric).
    const wantedMetrics = [...new Set([...KNOWN_METRICS, ...Object.keys(extraFields)])];

    // Some source tables carry a literal 'ALL' sentinel in campaign_id/adgroup_id
    // for an account-level daily summary row — a duplicate of totals already
    // derivable from the granular rows below it. Left in, it would double-count
    // spend/conversions as a bogus extra "campaign". Always excluded.
    const sql = `
      SELECT metrics, campaign_id, date, campaign_name, adgroup_id, adgroup_name,
             ${HOUR_COLUMNS.join(', ')}
      FROM ${this.opts.table}
      WHERE metrics = ANY($1) AND campaign_id <> 'ALL' AND adgroup_id <> 'ALL'
    `;
    const { rows } = await this.pool.query(sql, [wantedMetrics]);

    const normalized: RawExportRow[] = rows.map((r) => ({
      metrics: r.metrics ?? '',
      campaignId: r.campaign_id ?? '',
      date: toIsoDate(r.date),
      campaignName: r.campaign_name ?? '',
      adgroupId: r.adgroup_id ?? '',
      adgroupName: r.adgroup_name ?? '',
      hh: HOUR_COLUMNS.map((col) => String(r[col] ?? '0')),
    }));

    return pivotHourlyRows(normalized, extraFields);
  }

  describeTenant(): TenantDTO {
    return this.opts.tenant;
  }

  /** Unlike the CSV provider this cannot answer synchronously — the bound comes from a query. */
  async describeRange(): Promise<DateRange | null> {
    const { dates } = await this.data();
    const first = dates[0];
    const last = dates[dates.length - 1];
    return first && last ? { start: first, end: last } : null;
  }

  async listAccounts(): Promise<AccountDTO[]> {
    return [
      {
        surface: 'paid',
        externalId: this.opts.advertiserId,
        displayName: this.opts.tenant.clientName,
        username: null,
        avatarUrl: null,
        status: EntityStatus.Active,
      },
    ];
  }

  async listCampaigns(): Promise<CampaignDTO[]> {
    const { campaigns } = await this.data();
    return campaigns.map((c) => ({
      externalId: c.externalId,
      name: c.name,
      objective: inferObjective(c.name),
      status: EntityStatus.Active,
      dailyBudget: null,
    }));
  }

  async listAdgroups(): Promise<AdgroupDTO[]> {
    const { adgroups } = await this.data();
    return adgroups.map((a) => ({
      externalId: a.externalId,
      campaignExternalId: a.campaignExternalId,
      name: a.name,
      status: EntityStatus.Active,
    }));
  }

  async getPaidHourlyMetrics(
    _advertiserId: string,
    range: DateRange,
  ): Promise<PaidHourlyMetricDTO[]> {
    const { buckets } = await this.data();
    return buckets
      .filter((b) => b.date >= range.start && b.date <= range.end)
      .map((b) => ({
        date: b.date,
        hour: b.hour,
        campaignExternalId: b.campaignExternalId,
        adgroupExternalId: b.adgroupExternalId,
        spend: b.spend,
        impressions: Math.round(b.impressions),
        clicks: Math.round(b.clicks),
        reach: Math.round(b.reach),
        videoViews: Math.round(b.videoViews),
        videoWatched6s: Math.round(b.videoWatched6s),
        engagedView15s: Math.round(b.engagedView15s),
        engagements: Math.round(b.engagements),
        likes: Math.round(b.likes),
        comments: Math.round(b.comments),
        shares: Math.round(b.shares),
        follows: Math.round(b.follows),
        profileVisits: Math.round(b.profileVisits),
        conversions: Math.round(b.conversions),
        conversionValue: b.conversionValue,
        spanHours: b.spanHours,
      }));
  }

  /**
   * Daily rollup, summed from the same hourly buckets for the campaign-level
   * rows. `conversions`/`conversionValue` are 0 unless this client's provider
   * was configured with a conversion metric mapping (see `conversionMetric`).
   */
  async getPaidDailyMetrics(_advertiserId: string, range: DateRange): Promise<PaidMetricDTO[]> {
    const { buckets } = await this.data();
    const acc = new Map<string, PaidMetricDTO>();
    for (const b of buckets) {
      if (b.adgroupExternalId !== null) continue;
      if (b.date < range.start || b.date > range.end) continue;
      const key = `${b.date} ${b.campaignExternalId}`;
      const row = acc.get(key) ?? {
        date: b.date,
        campaignExternalId: b.campaignExternalId,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        videoViews: 0,
      };
      row.spend += b.spend;
      row.impressions += Math.round(b.impressions);
      row.clicks += Math.round(b.clicks);
      row.videoViews += Math.round(b.videoViews);
      row.conversions += Math.round(b.conversions);
      row.conversionValue += b.conversionValue;
      acc.set(key, row);
    }
    return [...acc.values()];
  }

  // --- Organic surface: not present in an Ads API export ---------------------
  async listVideos(): Promise<VideoDTO[]> {
    return [];
  }

  async getOrganicDailyMetrics(): Promise<OrganicMetricDTO[]> {
    return [];
  }
}
