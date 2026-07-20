import { loadTikTokConfig, type TikTokConfig } from './config.js';
import { FixtureTikTokProvider } from './fixtures/provider.js';
import { LiveTikTokProvider } from './live/provider.js';
import type { TikTokDataProvider } from './types.js';

/**
 * The one entry point the rest of the system uses to obtain a data provider.
 * Selection is driven entirely by configuration/env — no caller ever branches
 * on live-vs-fixture themselves.
 */
export const createTikTokProvider = (
  config: TikTokConfig = loadTikTokConfig(),
): TikTokDataProvider =>
  config.provider === 'live' ? new LiveTikTokProvider(config) : new FixtureTikTokProvider();
