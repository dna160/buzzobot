import type { DataSurface, DateRange } from '@tempo/core';
import type {
  AccountDTO,
  CampaignDTO,
  OrganicMetricDTO,
  PaidMetricDTO,
  TikTokDataProvider,
  VideoDTO,
} from '../types.js';
import type { TikTokConfig } from '../config.js';
import { TikTokBusinessClient } from './business-client.js';
import { TikTokDisplayClient } from './display-client.js';

/**
 * The live provider composes the Business (paid) and Display (organic) clients
 * behind the shared TikTokDataProvider interface. Account discovery is
 * expected to be seeded from the OAuth connection flow (Phase 2); for now it
 * surfaces the accounts implied by the configured credentials.
 */
export class LiveTikTokProvider implements TikTokDataProvider {
  readonly name = 'live';
  readonly surfaces: readonly DataSurface[];

  private readonly business: TikTokBusinessClient | null;
  private readonly display: TikTokDisplayClient | null;

  constructor(cfg: TikTokConfig) {
    this.business = cfg.business
      ? new TikTokBusinessClient({
          accessToken: cfg.business.accessToken,
          baseUrl: cfg.business.baseUrl,
        })
      : null;
    this.display = cfg.display
      ? new TikTokDisplayClient({ baseUrl: cfg.display.baseUrl })
      : null;

    const surfaces: DataSurface[] = [];
    if (this.business) surfaces.push('paid');
    if (this.display) surfaces.push('organic');
    this.surfaces = surfaces;
  }

  async listAccounts(): Promise<AccountDTO[]> {
    // Account discovery is finalized during OAuth onboarding. Until that lands
    // (Phase 2), the live provider yields no pre-known accounts.
    return [];
  }

  async listCampaigns(advertiserId: string): Promise<CampaignDTO[]> {
    this.requirePaid();
    return this.business!.listCampaigns(advertiserId);
  }

  async getPaidDailyMetrics(advertiserId: string, range: DateRange): Promise<PaidMetricDTO[]> {
    this.requirePaid();
    return this.business!.getDailyMetrics(advertiserId, range);
  }

  async listVideos(openId: string): Promise<VideoDTO[]> {
    this.requireOrganic();
    return this.display!.listVideos(openId);
  }

  async getOrganicDailyMetrics(openId: string, range: DateRange): Promise<OrganicMetricDTO[]> {
    this.requireOrganic();
    return this.display!.getDailyMetrics(openId, range);
  }

  private requirePaid(): void {
    if (!this.business) {
      throw new Error('Paid (Business API) credentials are not configured');
    }
  }

  private requireOrganic(): void {
    if (!this.display) {
      throw new Error('Organic (Display API) credentials are not configured');
    }
  }
}
