import { describe, expect, it } from 'vitest';
import { NorthStar } from '@tempo/core';
import type { FactSheet } from './facts.js';
import type { Narrative } from './schema.js';
import {
  stripUnactionableRisks,
  verifyNarrative,
  verifyNoUnsupportedMetrics,
} from './verify.js';
import { stripToJson } from './providers/openai-compatible.js';

const facts = {
  allowedNumbers: ['148.7', '1,705', '3,872', '0.23', '20:00', '04:00', '6.8', '56', '4'],
} as unknown as FactSheet;

const narrative = (over: Partial<Narrative> = {}): Narrative => ({
  headline: 'Spend concentrates in the evening.',
  summaryProse: 'Cimory spent IDR148.7M across 56 full hours over 4 days.',
  daypart: null,
  efficiency: null,
  mix: null,
  adgroup: null,
  dataGap: {
    title: 'Data Gap',
    body: 'The export carries no revenue column, so ROAS cannot be calculated.',
    tone: 'risk',
  },
  risks: [
    { risk: 'Spend sits in expensive hours', severity: 'high', action: 'Test dayparting over seven days.', owner: 'Media Buying' },
  ],
  outlook: ['The pattern is stable across the observed window.'],
  confidence: 'Medium',
  ...over,
});

describe('verifyNarrative — numeric guard', () => {
  it('accepts prose that only cites fact-sheet figures', () => {
    expect(verifyNarrative(narrative(), facts).ok).toBe(true);
  });

  it('rejects a fabricated currency figure', () => {
    // IDR 92.4M appears nowhere in the fact sheet — exactly the failure mode
    // that makes an LLM report untrustworthy, since it reads as authoritative.
    const bad = narrative({ summaryProse: 'Spend reached IDR92.4M over the period.' });
    const result = verifyNarrative(bad, facts);
    expect(result.ok).toBe(false);
    expect(result.violations[0]!.token).toBe('92.4');
  });

  it('rejects an invented figure inside a recommendation', () => {
    const bad = narrative({
      risks: [
        {
          risk: 'Budget waste',
          severity: 'high',
          action: 'Shifting budget could save IDR4.2M per day.',
          owner: 'Media Buying',
        },
      ],
    });
    const result = verifyNarrative(bad, facts);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.field.startsWith('risks'))).toBe(true);
  });

  it('allows small counts and clock times used as ordinary prose', () => {
    const ok = narrative({
      summaryProse: 'The 3 campaigns all peak at 20:00, with 2 of them slowing after.',
    });
    expect(verifyNarrative(ok, facts).ok).toBe(true);
  });

  it('matches a figure regardless of thousands punctuation', () => {
    const ok = narrative({ summaryProse: 'Cost per click averaged IDR1705.' });
    expect(verifyNarrative(ok, facts).ok).toBe(true);
  });
});

describe('verifyNoUnsupportedMetrics — vtr client (no on-platform outcome)', () => {
  it('allows stating that ROAS is unavailable', () => {
    expect(verifyNoUnsupportedMetrics(narrative(), NorthStar.Vtr).ok).toBe(true);
  });

  it('rejects a ROAS value', () => {
    const bad = narrative({ summaryProse: 'The account delivered a 3.4x blended ROAS.' });
    expect(verifyNoUnsupportedMetrics(bad, NorthStar.Vtr).ok).toBe(false);
  });

  it('rejects a CPA value', () => {
    const bad = narrative({ summaryProse: 'CPA landed at IDR 17,450 for the period.' });
    expect(verifyNoUnsupportedMetrics(bad, NorthStar.Vtr).ok).toBe(false);
  });

  it('rejects a conversion count', () => {
    const bad = narrative({ summaryProse: 'The campaigns produced 2,100 conversions.' });
    expect(verifyNoUnsupportedMetrics(bad, NorthStar.Vtr).ok).toBe(false);
  });
});

describe('verifyNoUnsupportedMetrics — shop client (real on-platform conversions)', () => {
  it('allows a ROAS value — this client genuinely has one', () => {
    const ok = narrative({ summaryProse: 'The account delivered a 3.4x blended ROAS.' });
    expect(verifyNoUnsupportedMetrics(ok, NorthStar.Shop).ok).toBe(true);
  });

  it('allows a CPA value and a conversion count — both are real for this client', () => {
    const ok = narrative({ summaryProse: 'CPA landed at IDR 17,450 with 2,100 conversions for the period.' });
    expect(verifyNoUnsupportedMetrics(ok, NorthStar.Shop).ok).toBe(true);
  });
});

describe('verifyNoUnsupportedMetrics — app-install client (installs, never revenue)', () => {
  it('rejects a ROAS value — no revenue concept exists for an install goal', () => {
    const bad = narrative({ summaryProse: 'The account delivered a 3.4x blended ROAS.' });
    expect(verifyNoUnsupportedMetrics(bad, NorthStar.AppInstall).ok).toBe(false);
  });

  it('allows a conversion (install) count', () => {
    const ok = narrative({ summaryProse: 'The campaigns produced 2,100 installs at IDR 17,450 CPA.' });
    expect(verifyNoUnsupportedMetrics(ok, NorthStar.AppInstall).ok).toBe(true);
  });
});

describe('stripUnactionableRisks — keeps the register actionable', () => {
  const entry = (risk: string, action = 'Do the thing, then compare next period.') => ({
    risk,
    severity: 'high',
    action,
    owner: 'Data / Ops',
  });

  it('drops an entry about conversions being unmeasurable (vtr client)', () => {
    const out = stripUnactionableRisks(
      {
        risks: [
          entry('Because the sale happens offline, conversions cannot be measured on TikTok'),
          entry('Spend lands in the weakest-viewing hours'),
        ],
      },
      NorthStar.Vtr,
    ) as { risks: unknown[] };
    expect(out.risks).toHaveLength(1);
  });

  it('drops a TikTok Shop entry for a vtr client — it sells offline, so this is never real', () => {
    const out = stripUnactionableRisks(
      { risks: [entry('There is no TikTok Shop integration to attribute sales through')] },
      NorthStar.Vtr,
    ) as { risks: unknown[] };
    expect(out.risks).toHaveLength(0);
  });

  it('drops the Indonesian phrasing of the same complaint', () => {
    const out = stripUnactionableRisks(
      { risks: [entry('Konversi tidak dapat diukur karena pembelian terjadi offline')] },
      NorthStar.Vtr,
    ) as { risks: unknown[] };
    expect(out.risks).toHaveLength(0);
  });

  it('keeps a genuine VTR risk that happens to mention spend', () => {
    const out = stripUnactionableRisks(
      { risks: [entry('63% of spend lands in hours viewing below the daily average')] },
      NorthStar.Vtr,
    ) as { risks: unknown[] };
    expect(out.risks).toHaveLength(1);
  });

  it('keeps a legitimate TikTok Shop risk for a shop client — it is normal vocabulary, not a complaint', () => {
    const out = stripUnactionableRisks(
      { risks: [entry('TikTok Shop checkout completion drops sharply during evening hours')] },
      NorthStar.Shop,
    ) as { risks: unknown[] };
    expect(out.risks).toHaveLength(1);
  });

  it('still drops a false "conversions cannot be measured" claim for a shop client', () => {
    // This brand's conversions ARE measured — a claim otherwise is simply
    // wrong, and unactionable either way, so it is still stripped.
    const out = stripUnactionableRisks(
      { risks: [entry('Conversions cannot be measured for this account')] },
      NorthStar.Shop,
    ) as { risks: unknown[] };
    expect(out.risks).toHaveLength(0);
  });

  it('passes through a response with no risks array', () => {
    const input = { headline: 'x' };
    expect(stripUnactionableRisks(input, NorthStar.Vtr)).toBe(input);
  });
});

describe('stripToJson — local model output tolerance', () => {
  it('unwraps a fenced code block', () => {
    expect(stripToJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('drops a chatty preamble before the object', () => {
    expect(stripToJson('Sure! Here is the JSON:\n{"a":1}')).toBe('{"a":1}');
  });

  it('leaves clean JSON untouched', () => {
    expect(stripToJson('{"a":1}')).toBe('{"a":1}');
  });
});
