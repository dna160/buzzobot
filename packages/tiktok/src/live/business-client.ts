import type { CampaignObjective, DataSurface, DateRange, EntityStatus } from '@tempo/core';
import type { CampaignDTO, PaidMetricDTO } from '../types.js';
import { requestJson } from './http.js';

/**
 * Client for the TikTok Business (Marketing) API v1.3 — paid surface.
 * Docs: https://business-api.tiktok.com/portal/docs
 *
 * Endpoints used:
 *   GET /open_api/v1.3/campaign/get/         — campaign metadata
 *   GET /open_api/v1.3/report/integrated/get — daily performance report
 *
 * Auth is via the long-lived Access-Token header on a specific advertiser_id.
 */
export class TikTokBusinessClient {
  constructor(
    private readonly cfg: { accessToken: string; baseUrl: string },
  ) {}

  readonly surface: DataSurface = 'paid';

  private headers() {
    return { 'Access-Token': this.cfg.accessToken };
  }

  async listCampaigns(advertiserId: string): Promise<CampaignDTO[]> {
    interface Resp {
      data?: { list?: RawCampaign[] };
    }
    const res = await requestJson<Resp>(`${this.cfg.baseUrl}/open_api/v1.3/campaign/get/`, {
      headers: this.headers(),
      query: {
        advertiser_id: advertiserId,
        page_size: 100,
      },
    });
    return (res.data?.list ?? []).map(mapCampaign);
  }

  async getDailyMetrics(advertiserId: string, range: DateRange): Promise<PaidMetricDTO[]> {
    interface Resp {
      data?: { list?: RawReportRow[] };
    }
    const res = await requestJson<Resp>(
      `${this.cfg.baseUrl}/open_api/v1.3/report/integrated/get/`,
      {
        headers: this.headers(),
        query: {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
          metrics: JSON.stringify([
            'spend',
            'impressions',
            'clicks',
            'conversion',
            'total_complete_payment_rate',
            'video_play_actions',
          ]),
          start_date: range.start,
          end_date: range.end,
          page_size: 1000,
        },
      },
    );
    return (res.data?.list ?? []).map(mapReportRow);
  }
}

interface RawCampaign {
  campaign_id: string;
  campaign_name: string;
  objective_type?: string;
  operation_status?: string;
  budget?: number;
}

interface RawReportRow {
  dimensions: { campaign_id: string; stat_time_day: string };
  metrics: Record<string, string | number>;
}

const OBJECTIVE_MAP: Record<string, CampaignObjective> = {
  REACH: 'reach',
  TRAFFIC: 'traffic',
  VIDEO_VIEWS: 'video_views',
  ENGAGEMENT: 'engagement',
  APP_PROMOTION: 'app_promotion',
  LEAD_GENERATION: 'lead_generation',
  WEB_CONVERSIONS: 'web_conversions',
  PRODUCT_SALES: 'product_sales',
};

const STATUS_MAP: Record<string, EntityStatus> = {
  ENABLE: 'active',
  DISABLE: 'paused',
  DELETE: 'deleted',
};

const num = (v: string | number | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0');
  return Number.isFinite(n) ? n : 0;
};

const mapCampaign = (c: RawCampaign): CampaignDTO => ({
  externalId: c.campaign_id,
  name: c.campaign_name,
  objective: OBJECTIVE_MAP[c.objective_type ?? ''] ?? 'traffic',
  status: STATUS_MAP[c.operation_status ?? ''] ?? 'active',
  dailyBudget: c.budget ?? null,
});

const mapReportRow = (row: RawReportRow): PaidMetricDTO => {
  const m = row.metrics;
  const conversions = num(m.conversion);
  return {
    date: row.dimensions.stat_time_day.slice(0, 10),
    campaignExternalId: row.dimensions.campaign_id,
    spend: num(m.spend),
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    conversions,
    // TikTok reports payment completion value under revenue-family metrics;
    // derive a value proxy when an explicit value metric isn't present.
    conversionValue: num(m.total_complete_payment ?? m.total_purchase_value),
    videoViews: num(m.video_play_actions),
  };
};
