import { describe, expect, it } from 'vitest';
import { cleanNarrative, stableSeed, ungroundedNumbers } from './grounding.js';

describe('stableSeed', () => {
  it('is deterministic and differs between inputs', () => {
    expect(stableSeed('abc')).toBe(stableSeed('abc'));
    expect(stableSeed('abc')).not.toBe(stableSeed('abd'));
  });

  it('is a safe positive integer', () => {
    for (const s of ['', 'x', 'a much longer prompt with data {"roi":9.6}']) {
      const v = stableSeed(s);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2_147_483_647);
    }
  });
});

describe('ungroundedNumbers', () => {
  const data = { roi: '9.60x', gmv: 'Rp3,1M', growth: '+57.8%', spend: 'Rp188,4Jt' };

  it('accepts figures copied from the data, whatever the decimal separator', () => {
    expect(ungroundedNumbers('ROI 9,60x, GMV Rp3,1M, tumbuh 57,8% dengan spend Rp188,4Jt.', data)).toEqual([]);
  });

  it('flags a figure the data never contained', () => {
    expect(ungroundedNumbers('ROI mencapai 12,5x dan spend Rp188,4Jt.', data)).toEqual(['12,5']);
  });

  it('ignores small counts and ordinals', () => {
    expect(ungroundedNumbers('3 dari 5 metrik baik, 2 perlu perbaikan selama 30 hari.', data)).toEqual([]);
  });

  it('does not treat a calendar year as a data claim', () => {
    expect(ungroundedNumbers('Periode 1 September 2026 sampai 30 September 2026.', data)).toEqual([]);
    // but a 4-digit figure that is not a year still counts
    expect(ungroundedNumbers('Order mencapai 4.512.', data)).toEqual(['4.512']);
  });

  it('works on a plain string as the data', () => {
    expect(ungroundedNumbers('Naik 45,2%.', 'growth +45.2%')).toEqual([]);
    expect(ungroundedNumbers('Naik 45,2%.', 'growth +54.2%')).toEqual(['45,2']);
  });
});

describe('cleanNarrative', () => {
  it('strips markdown, bullets and wrapping quotes', () => {
    expect(cleanNarrative('"**ROI** naik."')).toBe('ROI naik.');
    expect(cleanNarrative('- Poin satu\n- Poin dua')).toBe('Poin satu\nPoin dua');
  });
});
