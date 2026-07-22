import { z } from 'zod';

/**
 * Environment-driven configuration for the TikTok integration. Secrets are
 * read from the process environment and NEVER committed. When credentials are
 * absent we transparently fall back to the fixture provider so the app is
 * always runnable in local/demo contexts.
 */

export const TikTokConfigSchema = z.object({
  /**
   * 'live' talks to TikTok; 'fixture' serves deterministic synthetic data;
   * 'csv' serves a real brand's "daily in hourly" export from disk.
   */
  provider: z.enum(['live', 'fixture', 'csv']).default('fixture'),
  csv: z
    .object({
      filePath: z.string(),
      advertiserId: z.string(),
      tenant: z.object({
        clientName: z.string(),
        clientSlug: z.string(),
        agencyName: z.string(),
        agencySlug: z.string(),
        currency: z.string(),
        timezone: z.string(),
        brandColor: z.string().nullable(),
      }),
    })
    .nullable(),
  business: z
    .object({
      appId: z.string(),
      appSecret: z.string(),
      accessToken: z.string(),
      /** Base URL — overridable to point at the sandbox. */
      baseUrl: z.string().url().default('https://business-api.tiktok.com'),
    })
    .nullable(),
  display: z
    .object({
      clientKey: z.string(),
      clientSecret: z.string(),
      baseUrl: z.string().url().default('https://open.tiktokapis.com'),
    })
    .nullable(),
});

export type TikTokConfig = z.infer<typeof TikTokConfigSchema>;

/** Build config from environment variables, choosing the provider sensibly. */
export const loadTikTokConfig = (env: NodeJS.ProcessEnv = process.env): TikTokConfig => {
  const business =
    env.TIKTOK_APP_ID && env.TIKTOK_APP_SECRET && env.TIKTOK_BUSINESS_ACCESS_TOKEN
      ? {
          appId: env.TIKTOK_APP_ID,
          appSecret: env.TIKTOK_APP_SECRET,
          accessToken: env.TIKTOK_BUSINESS_ACCESS_TOKEN,
          baseUrl: env.TIKTOK_BUSINESS_BASE_URL ?? 'https://business-api.tiktok.com',
        }
      : null;

  const display =
    env.TIKTOK_DISPLAY_CLIENT_KEY && env.TIKTOK_DISPLAY_CLIENT_SECRET
      ? {
          clientKey: env.TIKTOK_DISPLAY_CLIENT_KEY,
          clientSecret: env.TIKTOK_DISPLAY_CLIENT_SECRET,
          baseUrl: env.TIKTOK_DISPLAY_BASE_URL ?? 'https://open.tiktokapis.com',
        }
      : null;

  const csv = env.TIKTOK_CSV_PATH
    ? {
        filePath: env.TIKTOK_CSV_PATH,
        advertiserId: env.TIKTOK_CSV_ADVERTISER_ID ?? 'csv-advertiser',
        tenant: {
          clientName: env.TIKTOK_CSV_CLIENT_NAME ?? 'Imported Client',
          clientSlug: env.TIKTOK_CSV_CLIENT_SLUG ?? 'imported-client',
          agencyName: env.TIKTOK_CSV_AGENCY_NAME ?? 'Buzzo Media',
          agencySlug: env.TIKTOK_CSV_AGENCY_SLUG ?? 'buzzo-media',
          currency: env.TIKTOK_CSV_CURRENCY ?? 'USD',
          timezone: env.TIKTOK_CSV_TIMEZONE ?? 'UTC',
          brandColor: env.TIKTOK_CSV_BRAND_COLOR ?? null,
        },
      }
    : null;

  // Explicit override wins; otherwise prefer a configured CSV export, then go
  // live only if we actually have creds.
  const explicit = env.TIKTOK_DATA_PROVIDER as 'live' | 'fixture' | 'csv' | undefined;
  const provider = explicit ?? (csv ? 'csv' : business || display ? 'live' : 'fixture');

  return TikTokConfigSchema.parse({ provider, business, display, csv });
};
