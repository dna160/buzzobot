# Brief Deck — build program

The delivery plan for [`docs/architecture/PRD_tempo_brief_deck.md`](../../architecture/PRD_tempo_brief_deck.md):
collapsing three client documents (Phase 1.5 daily report, hourly report, A4 engine
brief) into **one** artifact — a landscape 16:9 deck where every analytical claim is a
rendered `Finding` from `tempo-engine`.

Two codebases move together here, so this program is tracked separately from the
numbered phases in [`../README.md`](../README.md):

| | Owns |
| --- | --- |
| `tempo-engine/` (Python) | what is true — generators, probe loop, materiality, narration, gates |
| `packages/`, `apps/` (TypeScript) | what is shown — read-models, `DeckModel`, renderer, routes |

## Milestones

| M | Title | Status | Doc |
| --- | --- | --- | --- |
| M0 | Engine boundary — content v2, tiers, `/healthz` | ✅ Complete | [M0_ENGINE_BOUNDARY.md](./M0_ENGINE_BOUNDARY.md) |
| M1 | Contracts — catalog, `DeckModel`, `ReportSpec`, lights, grid | ✅ Complete | [M1_CONTRACTS.md](./M1_CONTRACTS.md) |
| M2 | Renderer — S0–S3, S6, Lampiran A, 16:9 pipeline | ✅ Complete | [M2_RENDERER.md](./M2_RENDERER.md) |
| M3 | Finding cards everywhere, S4 per objective (**K4 dies**) | ⏭ Planned | [M3_FINDING_CARDS.md](./M3_FINDING_CARDS.md) |
| M4 | S5 video slide, Lampiran B, thumbnail caching | ⏭ Planned | [M4_VIDEO.md](./M4_VIDEO.md) |
| M5 | Tiers end-to-end, `report_runs` + cron (**K6 dies**) | ⏭ Planned | [M5_TIERS_E2E.md](./M5_TIERS_E2E.md) |
| M6 | Spec editor for AMs | ⏭ Planned | [M6_SPEC_EDITOR.md](./M6_SPEC_EDITOR.md) |
| M7 | Kill list — **K1, K2, K3, K7 die**; K5 alias | ⏭ Planned | [M7_KILL_LIST.md](./M7_KILL_LIST.md) |

Ordering is not a preference. Nothing in the kill list (PRD §1) is deleted until the
exit criterion that replaces it has passed on a real client, which is why every
deletion sits at M3 or later while every contract sits at M0–M1.

## The handover protocol

Each milestone ends with its doc rewritten as a **handover** — the same four questions
the repo's existing phase docs answer (what shipped · contracts · how to verify ·
deferred), plus two this program needs because work crosses a language boundary and a
kill list:

5. **Entry contract** — the exact symbols, endpoints, and files the *next* milestone may
   build on, with the guarantee attached to each. A milestone that cannot state this has
   not finished.
6. **Kill-list state** — which K-rows this milestone made deletable, which it did not,
   and what evidence is still missing.

Write handovers so the next session can start without re-reading the codebase and
without re-deriving a decision. `HANDOVER_TEMPLATE.md` is the skeleton; copy it, don't
improvise a new shape.

### Rules that apply to every milestone

1. **Contracts before code.** A milestone that introduces a type publishes it (and its
   drift check, if it is mirrored across the Python/TypeScript boundary) before anything
   consumes it.
2. **No renderer reads engine JSON or read-model rows directly** (PRD §0.1). Everything
   renders from `DeckModel`. This is what keeps the output format swappable.
3. **"Stub" is not a state this system keeps** (PRD §1). Either a thing is built or it is
   documented as deferred with the reason — never a placeholder waiting to be noticed.
4. **A deletion needs telemetry, not confidence** (PRD §11 R6). K5's alias window exists
   because "kill" without caller logging is how portals break silently.
