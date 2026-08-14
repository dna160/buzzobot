import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CampaignObjective, EntityStatus, type DataSurface, type DateRange } from '@tempo/core';
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
import { parseHourlyExport, type HourBucket, type ParsedExport } from './parse.js';

/**
 * Serves a real brand's data from a TikTok "daily in hourly" CSV export.
 *
 * This is a paid-only provider: the export comes from the Business/Ads API and
 * carries no organic content data, so `surfaces` advertises 'paid' alone and
 * the organic methods return empty rather than fabricating rows.
 */
export interface CsvProviderOptions {
  filePath: string;
  advertiserId: string;
  tenant: TenantDTO;
  /** Raw metric name that feeds the generic `conversions` field, e.g. "onsite_shopping" or "app_install". */
  conversionMetric?: string;
  /** Raw metric name that feeds `conversionValue` (revenue), when the source reports one. */
  conversionValueMetric?: string;
}

/** Campaign names in this export encode the objective, e.g. "… | 15s Views | …". */
export function inferObjective(name: string): CampaignObjective {
  const n = name.toLowerCase();
  if (n.includes('views') || n.includes('view')) return CampaignObjective.VideoViews;
  if (n.includes('reach') || n.includes('r&f')) return CampaignObjective.Reach;
  if (n.includes('traffic')) return CampaignObjective.Traffic;
  if (n.includes('engagement')) return CampaignObjective.Engagement;
  return CampaignObjective.VideoViews;
}

const inRange = (date: string, range: DateRange) => date >= range.start && date <= range.end;

/**
 * Resolve a configured path against the workspace root, so the same relative
 * path works whether the caller is the web app, a package script, or the CLI.
 * Mirrors the resolution `@tempo/db` uses for the PGlite directory.
 */
function resolveFromWorkspaceRoot(p: string): string {
  if (isAbsolute(p)) return p;
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return resolve(dir, p);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), p);
}

export class CsvTikTokProvider implements TikTokDataProvider {
  readonly name = 'csv';
  readonly surfaces: readonly DataSurface[] = ['paid'];

  private parsed: ParsedExport | null = null;

  constructor(private readonly opts: CsvProviderOptions) {}

  private data(): ParsedExport {
    if (!this.parsed) {
      const path = resolveFromWorkspaceRoot(this.opts.filePath);
      if (!existsSync(path)) {
        throw new Error(
          `TikTok CSV export not found at "${path}" (from TIKTOK_CSV_PATH="${this.opts.filePath}").`,
        );
      }
      const extraFields: Record<string, keyof HourBucket> = {};
      if (this.opts.conversionMetric) extraFields[this.opts.conversionMetric] = 'conversions';
      if (this.opts.conversionValueMetric) {
        extraFields[this.opts.conversionValueMetric] = 'conversionValue';
      }
      this.parsed = parseHourlyExport(readFileSync(path, 'utf8'), extraFields);
    }
    return this.parsed;
  }

  describeTenant(): TenantDTO {
    return this.opts.tenant;
  }

  /** The export is a fixed window; callers use this instead of guessing one. */
  describeRange(): DateRange | null {
    const dates = this.data().dates;
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
    return this.data().campaigns.map((c) => ({
      externalId: c.externalId,
      name: c.name,
      objective: inferObjective(c.name),
      status: EntityStatus.Active,
      dailyBudget: null,
    }));
  }

  async listAdgroups(): Promise<AdgroupDTO[]> {
    return this.data().adgroups.map((a) => ({
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
    return this.data()
      .buckets.filter((b) => inRange(b.date, range))
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
   * Daily rollup, derived by summing this export's own hourly buckets for the
   * campaign-level rows. `conversions`/`conversionValue` are 0 unless this
   * client's provider was configured with a conversion metric mapping (see
   * `conversionMetric`/`conversionValueMetric`) — the daily table is retained
   * for continuity but the hourly grain is the real product.
   */
  async getPaidDailyMetrics(_advertiserId: string, range: DateRange): Promise<PaidMetricDTO[]> {
    const acc = new Map<string, PaidMetricDTO>();
    for (const b of this.data().buckets) {
      if (b.adgroupExternalId !== null) continue;
      if (!inRange(b.date, range)) continue;
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
