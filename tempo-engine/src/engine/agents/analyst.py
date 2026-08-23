"""The analyst — the probe loop, PRD §5.2, "the agentic centre." In:
`Finding[]` from the generator fan-out + `ObjectiveContract`. Out:
`ProbeRequest[]`, executed by deterministic code, producing additional
`Finding[]`. Bounded: max 6 probes, max 2 sequential rounds, hard timeout
(the LM Studio client's own per-call timeout). The agent never sees raw
rows — only `Finding` objects (as JSON) and instrument outputs.

Kill switch (PRD §11 risk #1, Hard Rule): `enabled=False` makes this an
immediate no-op — the graph must produce an acceptable brief with the probe
loop disabled, which it already does (B0-B6 never called this module at all).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from engine.contracts import EntityLevel, Finding, MetricFrame, ObjectiveContract
from engine.instruments import run_instrument
from engine.instruments.finding_builder import build_finding_from_instrument
from engine.llm.client import LmStudioClient
from engine.llm.prompts import build_analyst_system_prompt, build_analyst_user_prompt
from engine.llm.schemas import PROBE_BATCH_JSON_SCHEMA, ProbeBatch, ProbeRequest

MAX_PROBES = 6
MAX_ROUNDS = 2
ANALYST_TEMPERATURE = 0.2  # PRD §7.


@dataclass(frozen=True)
class ProbeLogEntry:
    probe: ProbeRequest
    result_ok: bool
    reason: str | None
    finding_id: str | None


@dataclass(frozen=True)
class AnalystResult:
    new_findings: list[Finding] = field(default_factory=list)
    probe_log: list[ProbeLogEntry] = field(default_factory=list)
    probes_executed: int = 0
    yield_rate: float = 0.0
    rounds_used: int = 0
    disabled: bool = False


def _has_entity_level_history(frame: MetricFrame) -> bool:
    if frame.prior_period is None:
        return False
    current_ids = {(r.entity.level, r.entity.id) for r in frame.records if r.period == frame.current_period and r.entity.level != EntityLevel.ACCOUNT}
    prior_ids = {(r.entity.level, r.entity.id) for r in frame.records if r.period == frame.prior_period and r.entity.level != EntityLevel.ACCOUNT}
    return bool(current_ids & prior_ids)


def _summarize_prior_probes(log: list[ProbeLogEntry]) -> str:
    if not log:
        return ""
    parts = []
    for entry in log:
        target = entry.probe.level or entry.probe.dimension or entry.probe.entity_id or "?"
        outcome = "found something" if entry.result_ok else f"nothing ({entry.reason})"
        parts.append(f"{entry.probe.instrument}({target}, metric={entry.probe.metric}) -> {outcome}")
    return "; ".join(parts)


async def run_probe_loop(
    findings: list[Finding],
    frame: MetricFrame,
    contract: ObjectiveContract,
    *,
    tenant_id: str,
    brief_type: str,
    client: LmStudioClient,
    enabled: bool = True,
    max_probes: int = MAX_PROBES,
    max_rounds: int = MAX_ROUNDS,
) -> AnalystResult:
    if not enabled:
        return AnalystResult(disabled=True)

    system = build_analyst_system_prompt(_has_entity_level_history(frame))
    probe_log: list[ProbeLogEntry] = []
    new_findings: list[Finding] = []
    probes_executed = 0
    round_number = 0

    while round_number < max_rounds and probes_executed < max_probes:
        round_number += 1
        remaining = max_probes - probes_executed
        user = build_analyst_user_prompt(findings, frame, round_number, _summarize_prior_probes(probe_log))

        try:
            raw = await client.complete_json(
                system=system, user=user, json_schema=PROBE_BATCH_JSON_SCHEMA,
                schema_name="probe_batch", temperature=ANALYST_TEMPERATURE,
            )
            batch = ProbeBatch.model_validate(json.loads(raw))
        except Exception:  # noqa: BLE001 - an unusable analyst response ends the loop, not the brief.
            break

        requested = batch.probes[:remaining]
        if not requested:
            break

        for probe in requested:
            probes_executed += 1
            result = run_instrument(
                probe.instrument, frame, contract,
                level=probe.level, metric=probe.metric, dimension=probe.dimension,
                dimension_value=probe.dimension_value, entity_id=probe.entity_id,
            )
            finding_id = f"probe_{probes_executed:02d}_{probe.instrument}"
            finding = build_finding_from_instrument(
                result, finding_id=finding_id, tenant_id=tenant_id, brief_type=brief_type, probe_id=finding_id
            )
            if finding is not None:
                new_findings.append(finding)
            probe_log.append(
                ProbeLogEntry(probe=probe, result_ok=result.ok, reason=result.reason, finding_id=finding.id if finding else None)
            )
            if probes_executed >= max_probes:
                break

    yield_rate = len(new_findings) / probes_executed if probes_executed > 0 else 0.0
    return AnalystResult(
        new_findings=new_findings, probe_log=probe_log, probes_executed=probes_executed,
        yield_rate=yield_rate, rounds_used=round_number,
    )
