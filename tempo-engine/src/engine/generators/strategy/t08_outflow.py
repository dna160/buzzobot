"""T08 — Outflow anomaly & flight end (Strategy Report PRD §7.3, definitions W2).

The latest day in the last 7 whose outflow is both a robust outlier (z ≥ 3 over
28 days) and ≥ 1.5× the mean of the 14 days before it. When daily spend fell
≥ 60% against its 7-day mean within the 3 days before the spike, it is
reported as a flight ending (`OUTFLOW_FLIGHT_END`) — "lines up with", never
"caused by".
"""

from __future__ import annotations

from datetime import timedelta

from engine.contracts import ClaimFrame, Direction
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import has_flow, in_range, make_finding, r
from engine.generators.strategy.base import StrategyGenerator
from engine.stats import robust_z_scores

Z_SPIKE = 3.0
MEAN_RATIO = 1.5
SPEND_DROP = 0.6


class T08Outflow(StrategyGenerator):
    id = "T08"
    name = "Outflow anomaly & flight end"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        spend = {s.date: s.spend for s in frame.spend}
        findings = []
        for stage in ("acc", "awareness", "consideration"):
            series = in_range(frame.audience.get(stage, []), frame.as_of - timedelta(days=27), frame.as_of)
            if len(series) < 21 or not has_flow(series, series[0].date, frame.as_of):
                continue
            outs = [d.outflow or 0.0 for d in series]
            z = robust_z_scores(outs)
            for i in range(len(series) - 1, max(len(series) - 8, 13), -1):
                prev14 = outs[i - 14 : i]
                mean14 = sum(prev14) / len(prev14) if prev14 else 0
                if z[i] < Z_SPIKE or mean14 <= 0 or outs[i] < MEAN_RATIO * mean14:
                    continue
                day = series[i].date
                drop = None
                for k in range(1, 4):
                    dd = day - timedelta(days=k)
                    before = [spend.get(dd - timedelta(days=j)) for j in range(1, 8)]
                    before = [b for b in before if b is not None]
                    if dd in spend and before and (m := sum(before) / len(before)) > 0 and spend[dd] <= (1 - SPEND_DROP) * m:
                        drop = (dd, 1 - spend[dd] / m)
                        break
                claim = ClaimFrame.OUTFLOW_FLIGHT_END if drop else ClaimFrame.OUTFLOW_SPIKE
                findings.append(
                    make_finding(
                        frame, id=f"t08_{stage}", generator=self.id, sections=[103, 108],
                        claim_frame=claim.value,
                        evidence={
                            "stage": stage,
                            "date": day.isoformat(),
                            "outflow": outs[i],
                            "mean_14d": round(mean14),
                            "ratio_to_mean": r(outs[i] / mean14, 2),
                            "robust_z": r(z[i], 2),
                            "spend_drop_date": drop[0].isoformat() if drop else None,
                            "spend_drop_pct": r(drop[1], 2) if drop else None,
                        },
                        magnitude=min(1.0, (outs[i] / mean14 - 1) / 3),
                        direction=Direction.NEGATIVE, actionability="medium", confidence="medium",
                        caveats=["Selaras waktu dengan penurunan belanja — bukan bukti sebab-akibat."] if drop else [],
                    )
                )
                break
        return GeneratorResult(findings=findings) if findings else self.gap("no outflow spike in the last 7 days")
