import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BriefObjective } from '@tempo/core';
import { describe, expect, it } from 'vitest';
import { buildDeckModel } from './build.js';
import { buildFindingCard, cardLight, evidenceChips, namedRowAction } from './cards.js';
import { parseEngineContent, type EngineFinding } from './engine-content.js';
import { buildDashboardFixture } from './fixtures/dashboard.js';
import type { Block, FindingCard } from './model.js';
import { defaultReportSpec } from './spec.js';

/**
 * M3's exit criterion (PRD §9): every card's chips resolve to real `evidence`
 * values — no chip may show a number the finding does not carry. That is the
 * property that carries the engine's numeral gate through to the slide.
 */

const RAW = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/engine-content.gmv.instant.json', import.meta.url)),
    'utf8',
  ),
) as unknown;

const parsed = parseEngineContent(RAW);
const content = parsed.content;

function model() {
  return buildDeckModel({
    content,
    contentVersion: parsed.version,
    dashboard: buildDashboardFixture(),
    spec: defaultReportSpec(BriefObjective.Gmv),
    objective: BriefObjective.Gmv,
    runId: 'run_cards',
    tier: 'instant',
    generatedAt: '2026-08-17T02:00:00.000Z',
    windowDays: 7,
  });
}

const allCards = (): FindingCard[] =>
  model()
    .slides.flatMap((s) => s.blocks)
    .filter((b): b is Extract<Block, { kind: 'findingCard' }> => b.kind === 'findingCard')
    .map((b) => b.card);

/** Digits in a rendered chip, so a value can be traced back to the evidence dict. */
const digitsOf = (text: string): string => text.replace(/\D/g, '');

describe('finding cards', () => {
  it('appear on the analysis slides', () => {
    expect(allCards().length).toBeGreaterThan(0);
  });

  it('every chip value traces back to a value in the finding evidence', () => {
    const byId = new Map(content.findings.map((f) => [f.id, f]));

    for (const card of allCards()) {
      const finding = byId.get(card.findingId);
      expect(finding, `card ${card.findingId} has no finding`).toBeDefined();

      const evidenceDigits = Object.values(finding!.evidence).map((v) =>
        digitsOf(typeof v === 'number' ? String(v) : v),
      );

      for (const chip of card.evidenceChips) {
        const chipDigits = digitsOf(chip.value);
        if (chipDigits === '') continue; // a purely textual value
        // Formatting may drop trailing precision ("0,39" from 0.3912), so a
        // chip's digits must be a prefix of some evidence value's digits —
        // never a figure that appears nowhere in the dict.
        expect(
          evidenceDigits.some((d) => d.startsWith(chipDigits) || chipDigits.startsWith(d)),
          `${card.findingId}: chip "${chip.label}: ${chip.value}" is not in the evidence`,
        ).toBe(true);
      }
    }
  });

  it('never shows an internal switch as a chip', () => {
    for (const card of allCards()) {
      for (const chip of card.evidenceChips) {
        expect(chip.label.toLowerCase()).not.toBe('rule');
        expect(chip.label.toLowerCase()).not.toBe('count metric');
      }
    }
  });

  it('carries level, confidence and source in the footer', () => {
    for (const card of allCards()) {
      expect(card.footer.level).toBeTruthy();
      expect(['tinggi', 'sedang', 'rendah']).toContain(card.footer.confidence);
      expect(card.footer.source).toMatch(/^(Probe · )?[A-Z]\d{2}$/);
    }
  });

  it('takes its light from the finding direction, not a re-derived threshold', () => {
    const finding = (direction: EngineFinding['direction']): EngineFinding => ({
      ...content.findings[0]!,
      direction,
    });
    expect(cardLight(finding('positive'))).toBe('green');
    expect(cardLight(finding('negative'))).toBe('red');
    expect(cardLight(finding('neutral'))).toBe('none');
  });

  it('formats evidence in Indonesian convention', () => {
    const finding: EngineFinding = {
      ...content.findings[0]!,
      evidence: { total_cost: 1_250_000, hhi: 0.3912, entity_count: 5, rule: 'dormant_entity' },
    };
    const chips = evidenceChips(finding, 'IDR');
    const byLabel = new Map(chips.map((c) => [c.label, c.value]));

    expect(byLabel.get('Total biaya')).toBe('Rp1.3M');
    expect(byLabel.get('Konsentrasi (HHI)')).toBe('0,39');
    expect(byLabel.get('Jumlah entitas')).toBe('5');
    // Large non-currency values drop false precision rather than printing
    // ",23" on a nine-digit figure.
    expect(
      evidenceChips({ ...finding, evidence: { aov_contribution: -247_020_272.23 } }, 'IDR')[0]!
        .value,
    ).toBe('-247.020.272');
    expect(byLabel.has('Rule')).toBe(false);
    // Composed labels: the engine's `<stem>_contribution` family reads as
    // Bahasa without needing a line per key.
    expect(evidenceChips({ ...finding, evidence: { aov_contribution: 1 } }, 'IDR')[0]!.label).toBe(
      'Kontribusi nilai pesanan',
    );
    expect(evidenceChips({ ...finding, evidence: { ctr_prior: 1 } }, 'IDR')[0]!.label).toBe(
      'CTR periode lalu',
    );
  });

  it('builds a card from engine copy without writing prose of its own', () => {
    const card = buildFindingCard(
      content.findings[0]!,
      { headline: 'H', mechanism: 'M', action: 'A' },
      'IDR',
    );
    expect(card.headline).toBe('H');
    expect(card.mechanism).toBe('M');
    expect(card.action).toBe('A');
  });
});

describe('namedRowAction', () => {
  const base = content.findings[0]!;

  it('names the culprit for a zero-yield finding', () => {
    const action = namedRowAction(
      { ...base, claim_frame: 'zero_yield_spend', evidence: { total_cost: 5_000_000 } },
      'IDR',
    );
    expect(action).toMatch(/^Matikan: total biaya Rp5M/);
  });

  it('upgrades a scaling finding to a budget action', () => {
    const action = namedRowAction(
      { ...base, claim_frame: 'marginal_return_scaling', evidence: { roi: 4.2 } },
      'IDR',
    );
    expect(action).toMatch(/^Tambah anggaran: /);
  });

  it('returns nothing for a frame that names no culprit', () => {
    expect(namedRowAction({ ...base, claim_frame: 'comparability_artifact' }, 'IDR')).toBeUndefined();
    expect(namedRowAction(undefined, 'IDR')).toBeUndefined();
  });
});

describe('coverage lines', () => {
  it('prints a counted denominator only where a signal is missing', () => {
    const notes = model()
      .slides.flatMap((s) => s.blocks)
      .filter((b): b is Extract<Block, { kind: 'coverageNote' }> => b.kind === 'coverageNote')
      .map((b) => b.text);

    for (const note of notes) {
      if (!note.includes('sinyal')) continue;
      const [available, total] = note.match(/\d+/g)!.map(Number);
      expect(available!).toBeLessThan(total!);
    }
  });
});
