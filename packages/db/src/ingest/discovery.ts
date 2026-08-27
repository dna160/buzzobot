import type pg from 'pg';
import { ClientTier, NorthStar } from '@tempo/core';
import type { PGlite } from '@electric-sql/pglite';

export interface DiscoveredBrand {
  table?: string;
  brandKey: string;
  slug: string;
  name: string;
  brandColor: string;
  currency: string;
  timezone: string;
  northStar: NorthStar;
  tier: ClientTier;
  tiktokAdAccountId?: string;
  brandId?: number;
  conversionMetric?: string;
  conversionValueMetric?: string;
  metrics: string[];
}

/** Curated modern luxury palette for automatic brand color assignment. */
const PALETTE = [
  '#1FD8C7', // Teal (Tempo default)
  '#FE2C55', // TikTok Red / Rose
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#F59E0B', // Amber
  '#10B981', // Emerald
  '#8B5CF6', // Purple / Violet
  '#3B82F6', // Royal Blue
  '#06B6D4', // Cyan
  '#F97316', // Orange
  '#14B8A6', // Dark Teal
  '#D946EF', // Fuchsia
];

/** Known explicit brand overrides if configured or needed. */
const BRAND_OVERRIDES: Record<
  string,
  {
    name?: string;
    slug?: string;
    northStar?: NorthStar;
    conversionMetric?: string;
    conversionValueMetric?: string;
  }
> = {
  bardi: { name: 'Bardi Jakarta', slug: 'bardi-jakarta', northStar: NorthStar.Shop },
  bardi_jakarta: { name: 'Bardi Jakarta', slug: 'bardi-jakarta', northStar: NorthStar.Shop },
  cimory: { name: 'Cimory', slug: 'cimory', northStar: NorthStar.Vtr },
  laneige: {
    name: 'Laneige',
    slug: 'laneige',
    northStar: NorthStar.Shop,
    conversionMetric: 'onsite_shopping',
    conversionValueMetric: 'total_onsite_shopping_value',
  },
  treasury: { name: 'Treasury', slug: 'treasury', northStar: NorthStar.AppInstall, conversionMetric: 'app_install' },
  kanzler: { name: 'Kanzler', slug: 'kanzler', northStar: NorthStar.Vtr },
  chocomory: { name: 'Chocomory', slug: 'chocomory', northStar: NorthStar.Vtr },
};

/** Deterministically pick a color from the palette based on brand slug hash. */
export function deriveBrandColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) {
    hash = (hash << 5) - hash + slug.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index]!;
}

/** Convert snake_case or kebab-case string to Title Case. */
export function formatBrandName(str: string): string {
  return str
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Convert brand key into URL-friendly slug. */
export function formatBrandSlug(brandKey: string): string {
  return brandKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Infer northStar, conversion metric, and conversion value metric from the active
 * non-zero metrics reported for this brand.
 */
export function inferBrandNorthStar(activeMetrics: string[]): {
  northStar: NorthStar;
  conversionMetric?: string;
  conversionValueMetric?: string;
} {
  const metricSet = new Set(activeMetrics.map((m) => m.toLowerCase()));

  // 1. TikTok Shop / E-Commerce conversions
  const hasOnsiteShopping = metricSet.has('onsite_shopping');
  const hasPurchase = metricSet.has('purchase') || metricSet.has('total_purchase');
  const hasOnsiteShoppingVal = metricSet.has('total_onsite_shopping_value');
  const hasPurchaseVal = metricSet.has('total_purchase_value');

  if (hasOnsiteShopping || hasPurchase) {
    const conversionMetric = hasOnsiteShopping ? 'onsite_shopping' : 'purchase';
    const conversionValueMetric = hasOnsiteShoppingVal
      ? 'total_onsite_shopping_value'
      : hasPurchaseVal
        ? 'total_purchase_value'
        : undefined;

    return {
      northStar: NorthStar.Shop,
      conversionMetric,
      conversionValueMetric,
    };
  }

  // 2. App Install conversions
  const hasAppInstall =
    metricSet.has('app_install') ||
    metricSet.has('cost_per_app_install') ||
    metricSet.has('real_time_app_install') ||
    metricSet.has('cta_app_install');

  if (hasAppInstall) {
    return {
      northStar: NorthStar.AppInstall,
      conversionMetric: 'app_install',
      conversionValueMetric: undefined,
    };
  }

  // 3. Awareness / Video View-Through Rate (VTR) default
  return {
    northStar: NorthStar.Vtr,
    conversionMetric: undefined,
    conversionValueMetric: undefined,
  };
}

const ACTIVE_HOUR_CONDITIONS = Array.from({ length: 24 }, (_, i) => `h${String(i).padStart(2, '0')} <> 0`).join(
  ' OR ',
);

/**
 * Auto-discover Buzzohero brands from PostgreSQL:
 * 1. Filter exclusively to Buzzohero brands (agency_id = 1, status = 'active').
 * 2. Premium clients: Have dedicated '*_daily_performance' tables with full hourly data.
 * 3. Standard clients: Accommodated for GMV Brief / daily summaries.
 */
export async function discoverPostgresBrands(pool: pg.Pool): Promise<DiscoveredBrand[]> {
  // Query all active Buzzohero brands
  let buzzoheroRows: Array<{
    id: number;
    name: string;
    tempo_slug: string | null;
    tiktok_ad_account_id: string;
    timezone: string | null;
  }> = [];

  try {
    const buzzoRes = await pool.query<{
      id: number;
      name: string;
      tempo_slug: string | null;
      tiktok_ad_account_id: string;
      timezone: string | null;
    }>(`
      SELECT id, name, tempo_slug, tiktok_ad_account_id, timezone
      FROM brands
      WHERE agency_id = 1 AND status = 'active'
      ORDER BY name;
    `);
    buzzoheroRows = buzzoRes.rows;
  } catch (err) {
    console.warn('[Auto-Discovery] Warning: could not query brands table:', err);
  }

  // Query all hourly performance tables matching '%_daily_performance'
  const tablesQuery = await pool.query<{ table_name: string }>(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name LIKE '%_daily_performance'
    ORDER BY table_name;
  `);

  const dailyTables = new Set(tablesQuery.rows.map((r) => r.table_name));
  const discovered: DiscoveredBrand[] = [];
  const processedSlugs = new Set<string>();

  // Helper to find matching hourly table for a brand
  const findHourlyTable = (brandKey: string, slug: string): string | undefined => {
    const candidates = [
      `${brandKey}_daily_performance`,
      `${brandKey.replace(/-/g, '_')}_daily_performance`,
      `${slug.replace(/-/g, '_')}_daily_performance`,
    ];
    return candidates.find((t) => dailyTables.has(t));
  };

  // 1. First process Premium brands (those with *_daily_performance tables)
  for (const table of dailyTables) {
    const brandKey = table.replace(/_daily_performance$/, '');
    const override = BRAND_OVERRIDES[brandKey] ?? BRAND_OVERRIDES[table];

    const slug = override?.slug ?? formatBrandSlug(brandKey);
    const name = override?.name ?? formatBrandName(brandKey);
    const brandColor = deriveBrandColor(slug);

    // Look for matching Buzzohero brand row if present
    const matchingBrand = buzzoheroRows.find(
      (b) =>
        (b.tempo_slug && b.tempo_slug.toLowerCase() === slug.toLowerCase()) ||
        formatBrandSlug(b.name) === slug ||
        b.name.toLowerCase().includes(brandKey.replace(/_/g, ' ')),
    );

    // Fetch active non-zero metrics from the brand's table
    let metrics: string[] = [];
    try {
      const metricsRes = await pool.query<{ metrics: string }>(`
        SELECT DISTINCT metrics 
        FROM ${table} 
        WHERE ${ACTIVE_HOUR_CONDITIONS};
      `);
      metrics = metricsRes.rows.map((r) => r.metrics).filter(Boolean);
    } catch {
      try {
        const metricsRes = await pool.query<{ metrics: string }>(`
          SELECT DISTINCT metrics FROM ${table};
        `);
        metrics = metricsRes.rows.map((r) => r.metrics).filter(Boolean);
      } catch (err) {
        console.warn(`[Auto-Discovery] Warning: could not inspect metrics for table "${table}":`, err);
      }
    }

    const inferred = inferBrandNorthStar(metrics);
    const northStar = override?.northStar ?? inferred.northStar;
    const conversionMetric = override?.conversionMetric ?? inferred.conversionMetric;
    const conversionValueMetric = override?.conversionValueMetric ?? inferred.conversionValueMetric;

    discovered.push({
      table,
      brandKey,
      slug,
      name,
      brandColor,
      currency: 'IDR',
      timezone: matchingBrand?.timezone || 'UTC',
      northStar,
      tier: ClientTier.Premium,
      tiktokAdAccountId: matchingBrand?.tiktok_ad_account_id,
      brandId: matchingBrand?.id,
      conversionMetric,
      conversionValueMetric,
      metrics,
    });
    processedSlugs.add(slug);
  }

  // 2. Process all remaining Buzzohero active brands as Standard (GMV Brief) tier
  for (const brand of buzzoheroRows) {
    const slug = brand.tempo_slug?.trim() || formatBrandSlug(brand.name);
    if (!slug || processedSlugs.has(slug)) continue;

    const brandKey = slug.replace(/-/g, '_');
    const override = BRAND_OVERRIDES[brandKey] ?? BRAND_OVERRIDES[slug];
    const hourlyTable = findHourlyTable(brandKey, slug);

    if (hourlyTable) {
      // It's a premium table we haven't added yet
      const brandColor = deriveBrandColor(slug);
      discovered.push({
        table: hourlyTable,
        brandKey,
        slug,
        name: brand.name,
        brandColor,
        currency: 'IDR',
        timezone: brand.timezone || 'UTC',
        northStar: override?.northStar ?? NorthStar.Shop,
        tier: ClientTier.Premium,
        tiktokAdAccountId: brand.tiktok_ad_account_id,
        brandId: brand.id,
        metrics: [],
      });
      processedSlugs.add(slug);
    } else {
      // Standard Buzzohero Brand — GMV Brief only
      const brandColor = deriveBrandColor(slug);
      discovered.push({
        brandKey,
        slug,
        name: brand.name,
        brandColor,
        currency: 'IDR',
        timezone: brand.timezone || 'UTC',
        northStar: override?.northStar ?? NorthStar.Shop, // Default to GMV brief
        tier: ClientTier.Standard,
        tiktokAdAccountId: brand.tiktok_ad_account_id,
        brandId: brand.id,
        metrics: ['spend', 'impressions', 'clicks', 'conversions', 'conversion_value'],
      });
      processedSlugs.add(slug);
    }
  }

  return discovered;
}

/**
 * Secondary discovery fallback: discover all brands already stored in the
 * sanitized database (useful for offline/demo operations).
 */
export async function discoverSanitizedBrands(pglite: PGlite): Promise<DiscoveredBrand[]> {
  // Check if clients table exists in pglite
  try {
    const clientsRes = await pglite.query<{
      name: string;
      slug: string;
      brand_color: string;
      currency: string;
      timezone: string;
      north_star: string;
      tier: string;
    }>(`
      SELECT name, slug, brand_color, currency, timezone, north_star, tier
      FROM clients
      ORDER BY name;
    `);

    if (clientsRes.rows.length > 0) {
      return clientsRes.rows.map((row) => ({
        table: row.tier === 'premium' ? `${row.slug.replace(/-/g, '_')}_daily_performance` : undefined,
        brandKey: row.slug.replace(/-/g, '_'),
        slug: row.slug,
        name: row.name,
        brandColor: row.brand_color || deriveBrandColor(row.slug),
        currency: row.currency || 'IDR',
        timezone: row.timezone || 'UTC',
        northStar: (row.north_star as NorthStar) || NorthStar.Shop,
        tier: (row.tier as ClientTier) || (row.slug === 'cimory' || row.slug === 'treasury' || row.slug === 'laneige' ? ClientTier.Premium : ClientTier.Standard),
        metrics: [],
      }));
    }
  } catch {
    // fallback to checking brand_hourly_tempo table
  }

  const tableCheck = await pglite.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'brand_hourly_tempo'
    );
  `);

  if (!tableCheck.rows[0]?.exists) {
    return [];
  }

  const brandsRes = await pglite.query<{ brand: string }>(`
    SELECT DISTINCT brand FROM brand_hourly_tempo ORDER BY brand;
  `);

  const discovered: DiscoveredBrand[] = [];

  for (const row of brandsRes.rows) {
    const brandKey = row.brand;
    const override = BRAND_OVERRIDES[brandKey];
    const slug = override?.slug ?? formatBrandSlug(brandKey);
    const name = override?.name ?? formatBrandName(brandKey);
    const brandColor = deriveBrandColor(slug);

    const metricsRes = await pglite.query<{ metrics: string }>(
      `SELECT DISTINCT metrics FROM brand_hourly_tempo WHERE brand = $1;`,
      [brandKey],
    );
    const metrics = metricsRes.rows.map((r) => r.metrics).filter(Boolean);
    const inferred = inferBrandNorthStar(metrics);

    const northStar = override?.northStar ?? inferred.northStar;
    const conversionMetric = override?.conversionMetric ?? inferred.conversionMetric;
    const conversionValueMetric = override?.conversionValueMetric ?? inferred.conversionValueMetric;

    discovered.push({
      table: `${brandKey}_daily_performance`,
      brandKey,
      slug,
      name,
      brandColor,
      currency: 'IDR',
      timezone: 'UTC',
      northStar,
      tier: ClientTier.Premium,
      conversionMetric,
      conversionValueMetric,
      metrics,
    });
  }

  return discovered;
}
