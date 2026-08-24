# M3 — Finding cards everywhere · S4 per objective — HANDOVER

**Status:** ✅ Complete · **Verified:** `pnpm typecheck` 8/8, `pnpm lint` 8/8, `pnpm test`
5/5 (164 tests in `@tempo/reports`), `uv run pytest` 187 passed / 21 skipped. A real PDF
through the actual pipeline: **7 pages for 7 slides, every MediaBox 960×540pt, 159 KB.**
Every slide was rendered and reviewed; five defects found that way are fixed (§7).
**K4 is dead** — `packages/reports/src/engine-brief/` no longer exists.

## 1. Scope

PRD §3.2 (`FindingCard`), §3.5 (named row actions), §4 (S4 row, coverage lines, honest
empty state), §1 K4. M2 rendered the deck frame with engine prose in `prose` blocks; M3
replaces that with the real card grammar and adds the one slide that is genuinely
different per objective. This is the milestone where the deck stops being a worse version
of the A4 brief, which is why the A4 brief dies in it.

## 2. What shipped

### `tempo-engine/`

- `contracts/content.py` — `CardCopy` (headline · mechanism · action) and
  `BriefContentV2.card_copy`, keyed by finding id. The agents narrate *sections*, so a
  deck showing one card per finding had nowhere to get the words; this is that source.
  Additive, so `content_version` stays 2 — the drift check, not the version number, is
  what protects consumers.
- `copy/templates.py` — `card_copy_for()` plus `_FRAME_MECHANISMS`: **one mechanism
  sentence per claim frame**, carrying *why* rather than *what*. This is PRD §11 R4's
  mitigation taken literally — the chips carry the figures, so the sentence carries the
  mechanism.
- `graphs/brief.py` — card copy computed for every scored finding (not only the selected
  ones: Lampiran C renders the below-the-cut list too), in both tiers. S1 on the instant
  path no longer appends an S6 risk (§7).
- Tests: 3 new in `test_instant_tier.py` — copy exists for every finding, is
  deterministic, and its headlines state no figure of their own.

### `@tempo/reports/deck/`

- `cards.ts` — `buildFindingCard`, `evidenceChips`, `cardLight`, `namedRowAction`. Every
  chip value is read straight from `finding.evidence`; nothing is recomputed, so the
  engine's numeral gate reaches the slide.
- `copy.ts` — `evidenceLabel()`: Bahasa labels for the engine's evidence-key vocabulary,
  with suffix composition (`aov_contribution` → "Kontribusi nilai pesanan") so the family
  of `_current` / `_prior` / `_contribution` keys needs no line each.
- `build.ts` — cards routed into S2/S3/S4 by the engine's own ranking, the
  objective-specific S4 slide (awareness: reach & frequency; GMV/install: the funnel),
  counted-denominator coverage lines, named row actions, honest empty state.
- `render.ts` — the card grammar in HTML: light chip → headline → evidence chips →
  mechanism → action → provenance footer.
- Tests: `cards.test.ts` (11) including the traceability property below; `build.test.ts`
  extended to 24 with S4 and empty-state coverage.

### Deleted (K4)

`packages/reports/src/engine-brief/render.ts` and its four barrel exports.

## 3. Entry contract for M4

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| `content.card_copy[findingId]` | engine + TS mirror | Present for every finding, deterministic | `test_instant_tier.py`, drift check |
| `buildFindingCard(finding, copy, currency)` | `deck/cards.ts` | Chips resolve to values in `evidence` | `cards.test.ts` traceability test |
| `evidenceChips(finding, currency)` | `deck/cards.ts` | Bahasa labels, no internal switches | `cards.test.ts` |
| `namedRowAction(finding, currency)` | `deck/cards.ts` | Named action only for frames that name a culprit | `cards.test.ts` |
| `MAX_CARDS` budget | `deck/build.ts` | A slide's blocks fit its page by construction | rendered + reviewed |
| `videoGrid` block | `deck/model.ts` | Still renders as nothing — M4 fills it | `render.ts` switch |

M4 adds the S5 slide and Lampiran B. `sectionCards(content, 5, …)` already works; what is
missing is the video read-model and the thumbnail cache, not the card machinery.

## 4. How to run / verify

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @tempo/reports try:deck deck.html gmv       # or awareness / install
cd tempo-engine && uv run pytest
```

`try:deck` renders the checked-in engine fixture with no database, engine, or browser —
open the file and print at 16:9 to see what the route produces.

## 5. Deferred

- **S5 cards.** The routing works, but S5 is the video slide and its data lands at M4.
- **Entity display names.** A G04 finding names its entity "5 adgroup entities" — engine
  vocabulary reaching a client slide. It is generator-side naming, not deck copy, so it
  belongs in an engine pass rather than a renderer patch.
- **Objective-specific S4 depth.** The funnel and reach tables use the day-grain rollup
  Tempo has today. A01–A04 / M01–M04 / N01–N04 findings render as cards on the slide, but
  their *charts* (retention curve, creator ladder, cohort quality) need entity-grain
  read-models that do not exist yet.
- **Image-diff goldens**, self-hosted font, IDR formatting below 10k — carried from M2.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |
| **K4** A4 engine-brief renderer | **Deleted** | The deck renders every claim the A4 brief did, as cards; nothing imports it |
| K1 fact-sheet narrative stack | Yes, pending M7 | tempo-engine is now the only narration source the deck reads |
| K2/K3 daily & hourly reports | No | Still served by `/api/reports/:slug`; needs the golden comparison at M7 |
| K7 report copy monolith | Partially | Deck strings live in `deck/copy.ts`; `i18n.ts` dies with K2–K4 at M7 |

## 7. Decisions taken here

- **Cards get deterministic per-finding copy; sections keep the narrated prose.** Mixing
  agent prose into some cards and templates into others would make "who wrote this
  sentence" unanswerable from the deck. So the narrated section draft renders *above* the
  cards — and only when an agent actually wrote it, because at the instant tier that
  draft *is* the top card's copy and printing both says the same thing twice.
- **A card's light is the finding's `direction`**, not a threshold re-applied by the
  deck. The generator already made that call; re-deriving it would be a second grading
  vocabulary, which §11 R8 exists to prevent.
- **The coverage line sits above the cards.** It was below them until a full slide
  clipped it — losing precisely the disclosure it exists to make.
- **Per-slide card budgets** (S2: 3, S3: 2, S4: 2). A slide is a fixed page with no
  reflow; the alternative to a budget is a card clipped mid-sentence.

Five defects were found by rendering the deck and looking at every slide:

1. **Chips restated the mechanism.** The card printed the same figures twice — once as
   chips, once in prose — because the engine's mechanism sentence was an evidence dump.
   Fixed by giving each claim frame a real mechanism sentence.
2. **False precision in chips**: `-247.020.272,23`. Two decimals on a nine-digit figure
   tells a reader nothing and costs half the chip's width.
3. **English chip labels** (`Aov contribution`) on a Bahasa deck — §3.4's rule broken by
   a vocabulary the catalog does not cover. Fixed with `evidenceLabel()`.
4. **The rank chart letterboxed into a stamp.** An SVG told to fill a short, wide box
   preserves its own ratio; charts are now drawn at a ratio chosen for this page.
5. **S1 stuttered.** The instant path appended an S6 risk to the summary, and an S6 risk
   there is the same finding restated with a label in front of it.
