"""T11 — Action re-measurement (Strategy Report PRD §5.6, definitions L).

For every accepted action still running: the target metric now vs when it
started (measured with the same `metric_value` the Target Solver sized it
with), the benchmark's change over the same days, and a verdict by fixed rule —
never a model's judgement:

- **failed** — the kill signal's days have elapsed and its metric did not move
  the required way;
- **worked** — the metric moved ≥ 50% of the way to target *and* beat the
  benchmark's change;
- **weak** — it moved the right way but not both;
- **running** — too early to tell.
"""

from __future__ import annotations

from engine.contracts import ClaimFrame, Direction
from engine.contracts.strategy import ActionItem, StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import bench_metric_value, make_finding, metric_value, pct, r
from engine.generators.strategy.base import StrategyGenerator

LOWER_IS_BETTER_KEYS = ("rank", "cost_per_1k_new", "outflow")


def _lower_better(key: str) -> bool:
    return any(k in key for k in LOWER_IS_BETTER_KEYS)


class T11ActionMeasurement(StrategyGenerator):
    id = "T11"
    name = "Action re-measurement"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        if not frame.open_actions:
            return self.gap("no accepted action is running")
        findings = []
        for oa in frame.open_actions:
            try:
                item = ActionItem.model_validate(oa.action)
            except Exception:  # noqa: BLE001 — a malformed stored action is skipped, never fatal
                continue
            days = (frame.as_of - oa.started_at).days
            start = item.current.value if item.current else metric_value(frame, item.metric_key, end=oa.started_at)
            now = metric_value(frame, item.metric_key)
            target = item.target.value if item.target else None
            lower = _lower_better(item.metric_key)
            moved_right = None if start is None or now is None else ((now < start) if lower else (now > start))
            progress = (now - start) / (target - start) if target is not None and start is not None and now is not None and target != start else None
            b_start = bench_metric_value(frame, item.metric_key, end=oa.started_at)
            b_now = bench_metric_value(frame, item.metric_key)
            cat = pct(b_now, b_start)
            own = pct(now, start)
            beat = None if cat is None or own is None else ((own < cat) if lower else (own > cat))

            killed = False
            ks = item.kill_signal
            if ks and days >= ks.days:
                k_start = metric_value(frame, ks.metric_key, end=oa.started_at)
                k_now = metric_value(frame, ks.metric_key)
                if k_start is not None and k_now is not None:
                    killed = (k_now <= k_start) if ks.condition == "no_rise_within_days" else (k_now >= k_start)
            if killed:
                verdict = "failed"
            elif progress is not None and progress >= 0.5 and beat is not False:
                verdict = "worked"
            elif moved_right:
                verdict = "weak" if ks is None or days >= ks.days else "running"
            else:
                verdict = "running"

            findings.append(
                make_finding(
                    frame, id=f"t11_{oa.id[:8]}", generator=self.id, sections=[109],
                    claim_frame=ClaimFrame.ACTION_MEASURED.value,
                    evidence={
                        "action_id": oa.id,
                        "metric_key": item.metric_key,
                        "start_value": r(start, 6) if start is not None else None,
                        "measured_value": r(now, 6) if now is not None else None,
                        "target_value": r(target, 6) if target is not None else None,
                        "progress": r(progress, 3) if progress is not None else None,
                        "category_delta": r(cat, 4) if cat is not None else None,
                        "verdict": verdict,
                        "days_running": days,
                        "started_at": oa.started_at.isoformat(),
                    },
                    magnitude=0.3 if verdict in ("worked", "failed") else 0.1,
                    direction={"worked": Direction.POSITIVE, "failed": Direction.NEGATIVE}.get(verdict, Direction.NEUTRAL),
                    actionability="low", confidence="medium",
                    caveats=["Dibandingkan dengan kategori pada hari yang sama; tidak membuktikan tindakan menjadi penyebabnya."],
                )
            )
        return GeneratorResult(findings=findings)
