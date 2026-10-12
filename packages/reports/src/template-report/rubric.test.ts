import { describe, expect, it } from 'vitest';
import { classifyFunnelStage } from './rubric.js';

/**
 * Every `objective_type` seen in the real source database (tiktok_ads_campaign,
 * since Jul 2026). A new TikTok objective that isn't here falls through to
 * "conversion" — add it below *and* to the classifier when it appears.
 */
describe('classifyFunnelStage', () => {
  it.each([
    ['REACH', 'awareness'],
    ['RF_REACH', 'awareness'],
    ['TOPVIEW_REACH', 'awareness'],
    ['VIDEO_VIEWS', 'awareness'],
    ['TRAFFIC', 'consideration'],
    ['ENGAGEMENT', 'consideration'],
    ['LEAD_GENERATION', 'consideration'],
    ['BRAND_CONSIDERATION', 'consideration'],
    ['APP_PROMOTION', 'conversion'],
    ['PRODUCT_SALES', 'conversion'],
    ['WEB_CONVERSIONS', 'conversion'],
    ['CONVERSIONS', 'conversion'],
  ] as const)('puts %s in %s', (objective, stage) => {
    expect(classifyFunnelStage(objective)).toBe(stage);
  });

  it('is case-insensitive and defaults an unknown or missing objective to conversion', () => {
    expect(classifyFunnelStage('brand_consideration')).toBe('consideration');
    expect(classifyFunnelStage('SOMETHING_NEW')).toBe('conversion');
    expect(classifyFunnelStage(null)).toBe('conversion');
  });
});
