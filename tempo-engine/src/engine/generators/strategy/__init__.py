"""Strategy Report generator battery (PRD §7.3). T01–T08, T10 and T11 are pure
functions of the frame; T09 (the Target Solver) runs last on their findings."""

from __future__ import annotations

from engine.generators.strategy.base import StrategyGenerator
from engine.generators.strategy.t01_funnel_flow import T01FunnelFlow
from engine.generators.strategy.t02_spend_response import T02SpendResponse
from engine.generators.strategy.t03_goal_pacing import T03GoalPacing
from engine.generators.strategy.t04_content_mix import T04ContentMix
from engine.generators.strategy.t05_sov_rank import T05SovRank
from engine.generators.strategy.t06_competitors import T06Competitors
from engine.generators.strategy.t07_search_sentiment import T07SearchSentiment
from engine.generators.strategy.t08_outflow import T08Outflow
from engine.generators.strategy.t09_target_solver import T09TargetSolver
from engine.generators.strategy.t10_coverage import T10Coverage
from engine.generators.strategy.t11_action_measurement import T11ActionMeasurement

STRATEGY_GENERATORS: tuple[StrategyGenerator, ...] = (
    T10Coverage(),
    T01FunnelFlow(),
    T02SpendResponse(),
    T03GoalPacing(),
    T04ContentMix(),
    T05SovRank(),
    T06Competitors(),
    T07SearchSentiment(),
    T08Outflow(),
    T11ActionMeasurement(),
)

__all__ = ["STRATEGY_GENERATORS", "StrategyGenerator", "T09TargetSolver"]
