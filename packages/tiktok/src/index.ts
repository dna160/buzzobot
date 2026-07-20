/**
 * @tempo/tiktok — the TikTok integration layer.
 *
 * Exposes a single provider abstraction over both TikTok surfaces (paid
 * Business API + organic Display API) with a deterministic fixture
 * implementation for credential-free local development.
 */

export * from './types.js';
export * from './config.js';
export { createTikTokProvider } from './factory.js';
export { FixtureTikTokProvider, FIXTURE_ADVERTISER_ID, FIXTURE_OPEN_ID } from './fixtures/provider.js';
export { LiveTikTokProvider } from './live/provider.js';
export { TikTokBusinessClient } from './live/business-client.js';
export { TikTokDisplayClient } from './live/display-client.js';
export { TikTokApiError } from './live/http.js';
