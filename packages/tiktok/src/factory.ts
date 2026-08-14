import { loadTikTokConfig, type TikTokConfig } from './config.js';
import { CsvTikTokProvider } from './csv/provider.js';
import { FixtureTikTokProvider } from './fixtures/provider.js';
import { LiveTikTokProvider } from './live/provider.js';
import { PostgresTikTokProvider } from './postgres/provider.js';
import type { TikTokDataProvider } from './types.js';

/**
 * The one entry point the rest of the system uses to obtain a data provider.
 * Selection is driven entirely by configuration/env — no caller ever branches
 * on live-vs-fixture-vs-csv-vs-postgres themselves.
 */
export const createTikTokProvider = (
  config: TikTokConfig = loadTikTokConfig(),
): TikTokDataProvider => {
  if (config.provider === 'live') return new LiveTikTokProvider(config);
  if (config.provider === 'csv') {
    if (!config.csv) {
      throw new Error(
        'TIKTOK_DATA_PROVIDER=csv but TIKTOK_CSV_PATH is not set — nothing to read.',
      );
    }
    return new CsvTikTokProvider(config.csv);
  }
  if (config.provider === 'postgres') {
    if (!config.postgres) {
      throw new Error(
        'TIKTOK_DATA_PROVIDER=postgres but TIKTOK_PG_TABLE is not set — nothing to read.',
      );
    }
    return new PostgresTikTokProvider(config.postgres);
  }
  return new FixtureTikTokProvider();
};
