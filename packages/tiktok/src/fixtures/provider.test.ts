import { describe, expect, it } from 'vitest';
import { FixtureTikTokProvider, FIXTURE_ADVERTISER_ID, FIXTURE_OPEN_ID } from './provider.js';

const range = { start: '2026-07-01', end: '2026-07-14' };

describe('FixtureTikTokProvider', () => {
  const provider = new FixtureTikTokProvider();

  it('exposes a paid and an organic account', async () => {
    const accounts = await provider.listAccounts();
    expect(accounts.map((a) => a.surface).sort()).toEqual(['organic', 'paid']);
  });

  it('produces deterministic paid metrics across runs', async () => {
    const a = await provider.getPaidDailyMetrics(FIXTURE_ADVERTISER_ID, range);
    const b = await provider.getPaidDailyMetrics(FIXTURE_ADVERTISER_ID, range);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((r) => r.spend >= 0 && r.impressions >= 0)).toBe(true);
  });

  it('paused campaigns spend nothing', async () => {
    const rows = await provider.getPaidDailyMetrics(FIXTURE_ADVERTISER_ID, range);
    const paused = rows.filter((r) => r.campaignExternalId === 'cmp_leadgen_paused');
    expect(paused.length).toBeGreaterThan(0);
    expect(paused.every((r) => r.spend === 0)).toBe(true);
  });

  it('only emits organic metrics on or after a video publish date', async () => {
    const rows = await provider.getOrganicDailyMetrics(FIXTURE_OPEN_ID, range);
    expect(rows.every((r) => r.date >= '2026-07-01')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});
