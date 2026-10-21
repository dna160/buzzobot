import { describe, expect, it } from 'vitest';
import { computeGmvMaxResidual, gmvMaxAccountTotalExternalId } from './gmv-max-residual.js';

const day = (adAccountId: string, date: string, gmvMaxCost: number, currency = 'IDR') => ({
  adAccountId,
  date,
  gmvMaxCost,
  currency,
});

describe('computeGmvMaxResidual', () => {
  it('books the whole day when the campaign table has nothing (BARDI, Kalibre)', () => {
    expect(computeGmvMaxResidual([day('bardi', '2026-10-01', 1_350_000)], [])).toEqual([
      { adAccountId: 'bardi', date: '2026-10-01', spend: 1_350_000 },
    ]);
  });

  it('books nothing when the campaign table already agrees (Evedaily, 0.006% apart)', () => {
    const r = computeGmvMaxResidual(
      [day('eve', '2026-10-01', 29_371_094)],
      [{ adAccountId: 'eve', date: '2026-10-01', cost: 29_369_378 }],
    );
    expect(r).toEqual([]);
  });

  it('books only the remainder when the campaign table covers part of the day', () => {
    const r = computeGmvMaxResidual(
      [day('acc', '2026-10-01', 1_000_000)],
      [
        { adAccountId: 'acc', date: '2026-10-01', cost: 300_000 },
        { adAccountId: 'acc', date: '2026-10-01', cost: 200_000 },
      ],
    );
    expect(r).toEqual([{ adAccountId: 'acc', date: '2026-10-01', spend: 500_000 }]);
  });

  it('never books a negative remainder when the campaign table reports more', () => {
    const r = computeGmvMaxResidual([day('acc', '2026-10-01', 100_000)], [{ adAccountId: 'acc', date: '2026-10-01', cost: 150_000 }]);
    expect(r).toEqual([]);
  });

  it('treats small gaps as noise by both the relative and the absolute floor', () => {
    expect(computeGmvMaxResidual([day('acc', '2026-10-01', 900)], [])).toEqual([]);
    expect(
      computeGmvMaxResidual([day('acc', '2026-10-01', 10_000_000)], [{ adAccountId: 'acc', date: '2026-10-01', cost: 9_950_000 }]),
    ).toEqual([]);
    expect(
      computeGmvMaxResidual([day('acc', '2026-10-01', 10_000_000)], [{ adAccountId: 'acc', date: '2026-10-01', cost: 9_850_000 }]),
    ).toEqual([{ adAccountId: 'acc', date: '2026-10-01', spend: 150_000 }]);
  });

  it('skips USD rows — Tempo does no FX', () => {
    expect(computeGmvMaxResidual([day('acc', '2026-10-01', 500, 'usd ')], [])).toEqual([]);
  });

  it('keeps accounts and days apart, sorted by date then account', () => {
    const r = computeGmvMaxResidual(
      [day('b', '2026-10-02', 50_000), day('a', '2026-10-02', 60_000), day('a', '2026-10-01', 70_000)],
      [{ adAccountId: 'b', date: '2026-10-01', cost: 999_999 }],
    );
    expect(r.map((x) => `${x.date}:${x.adAccountId}:${x.spend}`)).toEqual([
      '2026-10-01:a:70000',
      '2026-10-02:a:60000',
      '2026-10-02:b:50000',
    ]);
  });

  it('names one synthetic campaign per ad account', () => {
    expect(gmvMaxAccountTotalExternalId('6926791720868839425')).toBe('gmv-max-account-total:6926791720868839425');
  });
});
