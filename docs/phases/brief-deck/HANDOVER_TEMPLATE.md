# M_ — <title> — HANDOVER

**Status:** ⏭ Planned / 🚧 In progress / ✅ Complete · **Verified:** <the one sentence
that says what was actually run and what came back — not what should work>

## 1. Scope

One paragraph: what this milestone is for, and the PRD sections it implements.

## 2. What shipped

Concrete artifacts, grouped by side of the boundary (`tempo-engine/` vs `packages/` +
`apps/`). Paths, not prose.

## 3. Entry contract for the next milestone

The symbols, endpoints, and files the next milestone may rely on — each with the
guarantee that comes with it, and the test that holds it up.

| Contract | Where | Guarantee | Held up by |
| --- | --- | --- | --- |
| | | | |

Anything intentionally *not* stable yet goes here too, marked as such, so the next
milestone does not build on sand by accident.

## 4. How to run / verify

Copy-pasteable commands. Include what is skipped without a live Postgres / LM Studio /
Chromium, so a green run is not mistaken for full coverage.

## 5. Deferred

What was consciously left out and why — so it is not mistaken for an oversight. Include
the milestone it lands in, if it has one.

## 6. Kill-list state

| Row | Made deletable? | Evidence / what is still missing |
| --- | --- | --- |

## 7. Decisions taken here

Decisions this milestone closed that the PRD left open (or that came up mid-build), with
the reason. A decision recorded here does not get re-litigated next milestone.
