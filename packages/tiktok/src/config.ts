import { z } from 'zod';
import { NorthStar } from '@tempo/core';

/**
 * Environment-driven configuration for the TikTok integration. Secrets are
 * read from the process environment and NEVER committed. When credentials are
 * absent we transparently fall back to the fixture provider so the app is
 * always runnable in local/demo contexts.
 */

const tenantSchema = z.object({
  clientName: z.string(),
  clientSlug: z.string(),
  agencyName: z.string(),
  agencySlug: z.string(),
  currency: z.string(),
  timezone: z.string(),
  brandColor: z.string().nullable(),
  northStar: z.nativeEnum(NorthStar),
});

export const TikTokConfigSchema = z.object({
  /**
   * 'live' talks to TikTok; 'fixture' serves deterministic synthetic data;
   * 'csv' serves a real brand's "daily in hourly" export from disk; 'postgres'
   * serves the same wire format from a live-polled Postgres table.
   */
  provider: z.enum(['live', 'fixture', 'csv', 'postgres']).default('fixture'),
  csv: z
    .object({
      filePath: z.string(),
      advertiserId: z.string(),
      tenant: tenantSchema,
      conversionMetric: z.string().optional(),
      conversionValueMetric: z.string().optional(),
    })
    .nullable(),
  postgres: z
    .object({
      connection: z.object({
        host: z.string(),
        port: z.number(),
        database: z.string(),
        user: z.string(),
        password: z.string(),
      }),
      table: z.string(),
      advertiserId: z.string(),
      tenant: tenantSchema,
      conversionMetric: z.string().optional(),
      conversionValueMetric: z.string().optional(),
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
          northStar: (env.TIKTOK_CSV_NORTH_STAR as NorthStar | undefined) ?? NorthStar.Vtr,
        },
        conversionMetric: env.TIKTOK_CSV_CONVERSION_METRIC,
        conversionValueMetric: env.TIKTOK_CSV_CONVERSION_VALUE_METRIC,
      }
    : null;

  // The live-polled source shares its connection details (DB_HOST etc.) with
  // the sanitizer daemon that keeps the table current — one source of truth
  // for how to reach that database, rather than a second copy of the same
  // credentials under a different name.
  const postgres = env.TIKTOK_PG_TABLE
    ? {
        connection: {
          host: env.TIKTOK_PG_HOST ?? env.DB_HOST ?? 'localhost',
          port: Number(env.TIKTOK_PG_PORT ?? env.DB_PORT ?? 5432),
          database: env.TIKTOK_PG_DATABASE ?? env.DB_NAME ?? '',
          user: env.TIKTOK_PG_USER ?? env.DB_USER ?? '',
          password: env.TIKTOK_PG_PASSWORD ?? env.DB_PASSWORD ?? '',
        },
        table: env.TIKTOK_PG_TABLE,
        advertiserId: env.TIKTOK_PG_ADVERTISER_ID ?? 'postgres-advertiser',
        tenant: {
          clientName: env.TIKTOK_PG_CLIENT_NAME ?? 'Imported Client',
          clientSlug: env.TIKTOK_PG_CLIENT_SLUG ?? 'imported-client',
          agencyName: env.TIKTOK_PG_AGENCY_NAME ?? 'Buzzo Media',
          agencySlug: env.TIKTOK_PG_AGENCY_SLUG ?? 'buzzo-media',
          currency: env.TIKTOK_PG_CURRENCY ?? 'USD',
          timezone: env.TIKTOK_PG_TIMEZONE ?? 'UTC',
          brandColor: env.TIKTOK_PG_BRAND_COLOR ?? null,
          northStar: (env.TIKTOK_PG_NORTH_STAR as NorthStar | undefined) ?? NorthStar.Vtr,
        },
        conversionMetric: env.TIKTOK_PG_CONVERSION_METRIC,
        conversionValueMetric: env.TIKTOK_PG_CONVERSION_VALUE_METRIC,
      }
    : null;

  // Explicit override wins; otherwise prefer a configured live source (postgres,
  // then csv), then go live only if we actually have creds.
  const explicit = env.TIKTOK_DATA_PROVIDER as 'live' | 'fixture' | 'csv' | 'postgres' | undefined;
  const provider =
    explicit ?? (postgres ? 'postgres' : csv ? 'csv' : business || display ? 'live' : 'fixture');

  return TikTokConfigSchema.parse({ provider, business, display, csv, postgres });
};
