# M6 — Spec editor (AM-facing) — HANDOVER

**Status:** ⏭ Planned · **Verified:** —

## 1. Scope

PRD §3.3, §8, D3. M1 shipped `ReportSpec` as a validated contract with presets; M6 gives
account managers a way to edit one without code. Brands still choose presets — direct
brand self-service is explicitly v1.1.

## 2. Planned work

- Metric palette grouped by `MetricCategory`, filtered to `pickerVisible` metrics and to
  the objective's allowed set (an awareness spec offering `roas` is the bug §3.3 exists
  to prevent).
- Grid canvas; drop-to-replace = an array splice on `spec.metrics`. Slot Swap is not a
  layout feature — the solver re-derives the grid from the new order.
- Targets editor (`spec.targets`), which feeds `light()`'s highest-precedence branch.
- Persist through the `report_specs` repository shipped in M1.

## 3. Entry contract this milestone assumes

From M1: `ReportSpecSchema` (objective-constrained, 422 on a disallowed metric),
`REPORT_SPEC_PRESETS`, `getReportSpec`/`upsertReportSpec`, `solveKpiGrid`, `light()`.
The editor is a UI over these — it must not restate a validation rule in the client.

## 4. Exit criteria (PRD §9)

- An AM builds, saves, and exports a custom spec without code.
- Slot-swap re-renders correctly: the same spec produces the same grid every time
  (solver determinism test already in M1 covers the engine of this).
