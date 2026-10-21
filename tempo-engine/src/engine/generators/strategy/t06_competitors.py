"""T06 — Competitor movement (Strategy Report PRD §7.3, definitions W1).

From the daily ranking list: a competitor that climbed ≥ 3 places in 14 days
and now sits within 10 places of the brand (or in the top 10), one that fell as
far, and any that overtook the brand. Names are public brand names from
TikTok's list; TTMS gives their rank only, never their numbers, and the
finding says so.
"""

from __future__ import annotations

from datetime import timedelta

from engine.contracts import ClaimFrame, Direction, EntityRef, FindingLevel
from engine.contracts.strategy import StrategyFrame
from engine.generators.base import GeneratorResult
from engine.generators.strategy._util import last_day, make_finding
from engine.generators.strategy.base import StrategyGenerator

MOVE = 3
NEAR = 10
PER_STAGE = 3
CAVEAT = "TikTok hanya membagikan peringkat pesaing, bukan angka mereka."


class T06Competitors(StrategyGenerator):
    id = "T06"
    name = "Competitor movement"

    def _generate(self, frame: StrategyFrame) -> GeneratorResult:
        findings = []
        for stage in ("awareness", "consideration", "conversion"):
            comps = frame.competitors.get(stage, [])
            series = frame.audience.get(stage, [])
            own_now, own_then = last_day(series, frame.as_of), last_day(series, frame.as_of - timedelta(days=14))
            if not comps or not own_now or own_now.rank is None:
                continue
            own = own_now.rank
            moves = []
            for c in comps:
                if c.rank_14d is None:
                    continue
                climbed = c.rank_14d - c.rank_now
                near = abs(c.rank_now - own) <= NEAR or c.rank_now <= 10
                overtook = own_then is not None and own_then.rank is not None and c.rank_14d > own_then.rank and c.rank_now < own
                if overtook:
                    moves.append((ClaimFrame.BRAND_OVERTAKEN, c, climbed))
                elif climbed >= MOVE and near:
                    moves.append((ClaimFrame.COMPETITOR_CLIMBING, c, climbed))
                elif climbed <= -MOVE and near:
                    moves.append((ClaimFrame.COMPETITOR_FALLING, c, climbed))
            moves.sort(key=lambda m: (m[0] != ClaimFrame.BRAND_OVERTAKEN, -abs(m[2])))
            for claim, c, climbed in moves[:PER_STAGE]:
                slug = "".join(ch if ch.isalnum() else "_" for ch in c.brand.lower())[:40]
                findings.append(
                    make_finding(
                        frame, id=f"t06_{stage}_{slug}", generator=self.id, sections=[106, 108],
                        claim_frame=claim.value,
                        level=FindingLevel.COMPETITOR,
                        entity=EntityRef(id=f"competitor:{c.brand}", display_name=c.brand),
                        evidence={
                            "stage": stage,
                            "competitor": c.brand,
                            "rank_now": c.rank_now,
                            "rank_14d": c.rank_14d,
                            "rank_7d": c.rank_7d,
                            "rank_change_14d": climbed,
                            "own_rank": own,
                            "list_size": own_now.rank_n,
                        },
                        magnitude=min(1.0, abs(climbed) / 15),
                        direction=Direction.NEGATIVE if claim != ClaimFrame.COMPETITOR_FALLING else Direction.POSITIVE,
                        actionability="medium" if claim != ClaimFrame.COMPETITOR_FALLING else "low",
                        confidence="high",
                        caveats=[CAVEAT],
                        provenance=[f"market_scope_rankings_daily:{stage}:{frame.as_of}"],
                    )
                )
        if not findings:
            return self.gap("no competitor moved ≥ 3 places near the brand in 14 days")
        return GeneratorResult(findings=findings)
