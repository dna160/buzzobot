# M3 — Finding cards everywhere · S4 per objective — HANDOVER

**Status:** ⏭ Planned · **Verified:** —

## 1. Scope

PRD §3.2 (`FindingCard`), §4 (S4 row, coverage lines), §1 K4. M2 renders the deck frame
with engine prose in `prose` blocks; M3 replaces that with the real card grammar —
light chip → headline → evidence chips → mechanism → action — sourced from `Finding`
objects, and adds the objective-specific S4 slide. The A4 engine-brief renderer dies
here because this is the milestone where the deck stops being a worse version of it.

## 2. Planned work

- `deck/cards.ts` — `findingCard` block renderer; chips resolve from `finding.evidence`
  by key, never re-derived, so the numeral gate's guarantee carries into the deck.
- `buildDeckModel`: route `content.findings` by `section_affinity` × `rankings.selected`
  into S2/S3/S4/S5 card slots (≤3 for S2, per PRD §4).
- S4 per objective: awareness A01–A04 (frequency/effective reach), gmv M01–M04 (funnel &
  mix), install N01–N04 (funnel leak, cohort quality) — chart/table blocks per objective.
- Counted-denominator coverage lines from `content.coverage.signals` — *"4 dari 6 sinyal
  tersedia"*, never silence.
- Honest empty state: a section with no findings above the cut renders its data blocks
  plus *"Tidak ada temuan material periode ini"*.
- **K4:** delete `packages/reports/src/engine-brief/render.ts` and its exports.

## 3. Entry contract this milestone assumes

From M0: `content.findings` (all findings, generator + probe origin), `content.rankings`
(selected + below-cut), `content.coverage.signals`. From M1: `light()`, `MetricDef.labelId`.
From M2: `Block` union already carries `findingCard`; `buildDeckModel` is the only place
engine content is read.

## 4. Exit criteria (PRD §9)

- Every card's evidence chips resolve to real `evidence` values — no chip renders a
  number the finding does not carry (test over fixture + live content).
- A section with zero findings above the cut renders the honest empty state, not an
  empty card and not a fabricated one.
- The generic-sentence detector (engine eval harness) runs against deck card text.
- `packages/reports/src/engine-brief/` no longer exists; `pnpm typecheck` green.
