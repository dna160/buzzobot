"""T09 — Target Solver (Strategy Report PRD §5.4 [LOCKED], §7.3).

Turns findings into at most three sized, dated, falsifiable `ActionItem`s. The
numbers — current, target, horizon, stake, kill signal — are all computed
here; a model only ever phrases them, and the Action Gate holds it to them.

Lever table (PRD §7.3), with the P0 corrections:
- `stage_targeting` targets a **size ratio**, never a "move-on rate"; its kill
  signal for the shop class is product-card clicks, since Conversion-stage new
  audience is 0 every day for 14 of 15 accounts (P0 §6.3).
- `content_mix` moves the non-paid content type furthest below its benchmark
  share; sub-types are never summed (P0 §6.6).
- `creator_boost` (brand class, SOV losing): vertical shares are fractions of a
  percent (BARDI 0.24%), so the PRD's "+3 points" step is read as +30%
  relative — a 3-point step on a 0.24% share would be a 13× jump.
- `budget_cap` only from a DIMINISHING spend response with R² ≥ 0.5; below
  that the action would be low confidence, which PRD §14.1 suppresses.

Ranking: sized actions before `investigate` (which has no target to size),
then by confidence (low never above medium), then by the trigger finding's
materiality — the stakes are in different units (people, impressions,
rupiah), so they cannot be ranked against each other directly.
"""

from __future__ import annotations

from datetime import timedelta

from engine.contracts import ClaimFrame, Direction, Finding
from engine.contracts.strategy import (
    ActionItem,
    ActionStake,
    ActionValue,
    KillSignal,
    StrategyFrame,
)
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import make_finding, metric_value, r

MAX_ACTIONS = 3
HORIZON_DAYS = 28
STAGE_STEP = 0.05  # +5 points of size ratio per 28 days
MIX_STEP = 0.08  # +8 points of impressions share per 28 days
SOV_REL_STEP = 0.30  # +30% relative vertical share per 28 days
STAKE_RANGE = 0.30

CONTENT_PHRASE = {
    "bgc_organic": "konten BGC internal (organik)",
    "bgc_boosted": "konten BGC internal yang di-boost",
    "creator_organic": "video afiliasi/kreator (organik)",
    "creator_boosted": "video afiliasi/kreator yang di-boost",
    "ugc_organic": "konten pengguna (UGC) organik",
    "ugc_boosted": "konten pengguna (UGC) yang di-boost",
    "ads": "iklan",
}
STAGE_NAME = {"acc": "ACC", "awareness": "Awareness", "consideration": "Consideration", "conversion": "Conversion"}
CONF_ORDER = {"high": 0, "medium": 1, "low": 2}


def _stake(value: float, unit: str) -> ActionStake:
    return ActionStake(value=round(value), unit=unit, range=(round(value * (1 - STAKE_RANGE)), round(value * (1 + STAKE_RANGE))))  # type: ignore[arg-type]


def _conf(trigger: Finding) -> str:
    c = trigger.confidence.value
    return "medium" if c == "high" else c


def candidates(frame: StrategyFrame, findings: list[Finding]) -> list[tuple[ActionItem, Finding]]:
    by_frame: dict[str, list[Finding]] = {}
    for f in findings:
        by_frame.setdefault(f.claim_frame, []).append(f)
    cls = frame.classification.report_class
    by = frame.as_of + timedelta(days=HORIZON_DAYS)
    entity = {"level": "brand", "id": f"ttms:{frame.ttms_account_id}", "display_name": frame.brand_name}
    out: list[tuple[ActionItem, Finding]] = []

    # stage_targeting ← STAGE_LEAK (shop: Consideration→Conversion first; brand: Awareness→Consideration first)
    leaks = by_frame.get(ClaimFrame.STAGE_LEAK.value, [])
    prefer = "consideration" if cls == "shop" else "awareness"
    leaks.sort(key=lambda f: (f.evidence.get("stage") != prefer, -f.magnitude_pct))
    if leaks:
        f = leaks[0]
        stage, nxt = str(f.evidence["stage"]), str(f.evidence["next_stage"])
        cur, bench = float(f.evidence["size_ratio"]), float(f.evidence["bench_size_ratio"])
        target = min(bench, cur + STAGE_STEP)
        kill_key = "ttms.product_card_clicks" if stage == "consideration" else "ttms.audience.consideration.new"
        out.append((
            ActionItem(
                id="", rank=0, priority="P1", lever="stage_targeting",
                metric_key=f"ttms.audience.{stage}.size_ratio", entity=entity,
                current=ActionValue(value=r(cur), format="percent", as_of=frame.as_of),
                target=ActionValue(value=r(target), format="percent", by=by),
                horizon_days=HORIZON_DAYS, delta={"abs": r(target - cur), "pct": r((target - cur) / cur) if cur else 0.0},
                stake=_stake((target - cur) * float(f.evidence["stage_total"]), "people"),
                basis="benchmark_top10", confidence=_conf(f),  # type: ignore[arg-type]
                kill_signal=KillSignal(metric_key=kill_key, condition="no_rise_within_days", days=14),
                evidence_refs=[f.id], subject=f"audiens tahap {STAGE_NAME[stage]} menuju {STAGE_NAME[nxt]}",
            ),
            f,
        ))

    # budget_cap ← SPEND_RESPONSE_DIMINISHING with a fit worth acting on
    for f in by_frame.get(ClaimFrame.SPEND_RESPONSE_DIMINISHING.value, []):
        if float(f.evidence.get("r2", 0)) < 0.5 or "knee_daily_spend" not in f.evidence:
            continue
        knee = float(f.evidence["knee_daily_spend"])
        avg = float(f.evidence["window_spend"]) / frame.window_days
        stage = str(f.evidence["stage"])
        out.append((
            ActionItem(
                id="", rank=0, priority="P1", lever="budget_cap", metric_key="strategy.spend_cap_daily", entity=entity,
                current=ActionValue(value=round(avg), format="idr", as_of=frame.as_of),
                target=ActionValue(value=round(knee), format="idr", by=by),
                horizon_days=HORIZON_DAYS, delta={"abs": round(knee - avg), "pct": r((knee - avg) / avg) if avg else 0.0},
                stake=_stake(float(f.evidence.get("spend_above_knee_window", 0)) * 30 / frame.window_days, "idr"),
                basis="solver_cap", confidence="medium",
                kill_signal=KillSignal(metric_key=f"strategy.cost_per_1k_new.{stage}", condition="no_fall_within_days", days=14),
                evidence_refs=[f.id], subject="belanja harian",
            ),
            f,
        ))

    # content_mix ← CONTENT_MIX_PAID_HEAVY or HALO_BELOW_BENCHMARK
    mix = by_frame.get(ClaimFrame.HALO_BELOW_BENCHMARK.value, []) + by_frame.get(ClaimFrame.CONTENT_MIX_PAID_HEAVY.value, [])
    if mix:
        f = mix[0]
        ct = str(f.evidence["weakest_type"])
        cur = float(f.evidence["weakest_share"])
        bench = f.evidence.get("weakest_bench_share")
        ceiling = float(bench) if bench is not None and float(bench) > cur else cur + MIX_STEP
        target = min(ceiling, cur + MIX_STEP)
        if target > cur:
            out.append((
                ActionItem(
                    id="", rank=0, priority="P1", lever="content_mix", metric_key=f"ttms.impressions.share.{ct}", entity=entity,
                    current=ActionValue(value=r(cur), format="percent", as_of=frame.as_of),
                    target=ActionValue(value=r(target), format="percent", by=by),
                    horizon_days=HORIZON_DAYS, delta={"abs": r(target - cur), "pct": r((target - cur) / cur) if cur else 0.0},
                    stake=_stake((target - cur) * float(f.evidence["impressions_all"]), "impressions"),
                    basis="benchmark_top10", confidence=_conf(f),  # type: ignore[arg-type]
                    kill_signal=KillSignal(metric_key=f"ttms.impressions.share.{ct}", condition="no_rise_within_days", days=14),
                    evidence_refs=[x.id for x in mix[:2]], subject=CONTENT_PHRASE.get(ct, ct),
                ),
                f,
            ))

    # creator_boost ← SOV_LOSING (brand class)
    losing = [f for f in by_frame.get(ClaimFrame.SOV_LOSING.value, []) if f.evidence.get("metric") in ("impressions", "engagements")]
    if cls == "brand" and losing:
        f = max(losing, key=lambda x: x.magnitude_pct)
        m = str(f.evidence["metric"])
        cur, prior = float(f.evidence["share_now"]), float(f.evidence["share_prior"])
        target = min(prior, cur * (1 + SOV_REL_STEP))
        out.append((
            ActionItem(
                id="", rank=0, priority="P1", lever="creator_boost", metric_key=f"ttms.{m}.share", entity=entity,
                current=ActionValue(value=r(cur, 6), format="percent", as_of=frame.as_of),
                target=ActionValue(value=r(target, 6), format="percent", by=by),
                horizon_days=HORIZON_DAYS, delta={"abs": r(target - cur, 6), "pct": r((target - cur) / cur) if cur else 0.0},
                stake=_stake((target - cur) / cur * (metric_value(frame, f"ttms.{m}") or 0) if cur else 0, "impressions" if m == "impressions" else "people"),
                basis="own_history", confidence=_conf(f),  # type: ignore[arg-type]
                kill_signal=KillSignal(metric_key="ttms.engagements.share", condition="no_rise_within_days", days=14),
                evidence_refs=[f.id], subject="video afiliasi/kreator yang di-boost",
            ),
            f,
        ))

    # creative_refresh ← OUTFLOW_FLIGHT_END
    for f in by_frame.get(ClaimFrame.OUTFLOW_FLIGHT_END.value, [])[:1]:
        stage = str(f.evidence["stage"])
        cur, target = float(f.evidence["outflow"]), float(f.evidence["mean_14d"])
        out.append((
            ActionItem(
                id="", rank=0, priority="P1", lever="creative_refresh", metric_key=f"ttms.audience.{stage}.outflow", entity=entity,
                current=ActionValue(value=round(cur), format="number", as_of=frame.as_of),
                target=ActionValue(value=round(target), format="number", by=frame.as_of + timedelta(days=14)),
                horizon_days=14, delta={"abs": round(target - cur), "pct": r((target - cur) / cur) if cur else 0.0},
                stake=_stake(cur - target, "people"),
                basis="own_history", confidence=_conf(f),  # type: ignore[arg-type]
                kill_signal=KillSignal(metric_key=f"ttms.audience.{stage}.outflow", condition="no_fall_within_days", days=14),
                evidence_refs=[f.id], subject=f"audiens keluar tahap {STAGE_NAME[stage]}",
            ),
            f,
        ))

    # investigate ← COMPETITOR_CLIMBING / BRAND_OVERTAKEN (no target, no kill signal)
    rivals = by_frame.get(ClaimFrame.BRAND_OVERTAKEN.value, []) + by_frame.get(ClaimFrame.COMPETITOR_CLIMBING.value, [])
    if rivals:
        f = max(rivals, key=lambda x: (x.claim_frame == ClaimFrame.BRAND_OVERTAKEN.value, x.magnitude_pct))
        out.append((
            ActionItem(
                id="", rank=0, priority="P2", lever="investigate", metric_key=f"ttms.audience.{f.evidence['stage']}.rank", entity=entity,
                current=None, target=None, horizon_days=7, stake=None, basis="defensive", confidence="high",
                kill_signal=None, evidence_refs=[f.id], subject=str(f.evidence["competitor"]),
            ),
            f,
        ))
    return out


def solve(frame: StrategyFrame, findings: list[Finding]) -> list[ActionItem]:
    """All candidates, one per lever, ranked; the first three are the Action
    List and the rest go to Lampiran A as "kandidat berikutnya"."""
    seen: set[str] = set()
    ranked: list[ActionItem] = []
    ordered = sorted(candidates(frame, findings), key=lambda c: (c[0].lever == "investigate", CONF_ORDER[c[0].confidence], -c[1].materiality))
    for item, _trigger in ordered:
        if item.lever in seen:
            continue
        seen.add(item.lever)
        n = len(ranked) + 1
        ranked.append(item.model_copy(update={"id": f"act_{n:02d}", "rank": n, "priority": "P2" if item.lever == "investigate" else ("P0" if n == 1 else ("P1" if n == 2 else "P2"))}))
    return ranked


class T09TargetSolver:
    """Runs after T01–T08 (it consumes their findings), so it is not a plain
    `StrategyGenerator`."""

    id = "T09"
    name = "Target Solver"

    def run(self, frame: StrategyFrame, findings: list[Finding]) -> tuple[GeneratorResult, list[ActionItem]]:
        actions = solve(frame, findings)
        out = []
        for a in actions:
            ev = {
                "lever": a.lever,
                "metric_key": a.metric_key,
                "current": a.current.value if a.current else None,
                "target": a.target.value if a.target else None,
                "horizon_days": a.horizon_days,
                "stake": a.stake.value if a.stake else None,
                "stake_low": a.stake.range[0] if a.stake else None,
                "stake_high": a.stake.range[1] if a.stake else None,
                "stake_unit": a.stake.unit if a.stake else None,
                "kill_days": a.kill_signal.days if a.kill_signal else None,
                "basis": a.basis,
                "action_rank": a.rank,
            }
            out.append(
                make_finding(
                    frame, id=f"t09_{a.id}", generator="T09",
                    sections=[102] if a.rank <= MAX_ACTIONS else [110],
                    claim_frame=ClaimFrame.ACTION_PROPOSED.value,
                    evidence=ev, magnitude=max(0.05, 1 - 0.2 * a.rank), direction=Direction.NEUTRAL,
                    actionability="high", confidence=a.confidence,
                    provenance=list(a.evidence_refs),
                )
            )
        return GeneratorResult(findings=out), actions
