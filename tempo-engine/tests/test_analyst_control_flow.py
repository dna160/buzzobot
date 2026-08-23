"""Analyst probe-loop bounds, tested against a scripted mock client — fast
and deterministic. Live yield measurement is in test_probe_loop_live.py.
"""

from __future__ import annotations

import json

from engine.agents.analyst import MAX_PROBES, MAX_ROUNDS, run_probe_loop
from eval.fixtures.sovella_gmv_week import GMV_OBJECTIVE_CONTRACT, TENANT_ID, build_sovella_gmv_metric_frame


class _ScriptedClient:
    def __init__(self, responses: list) -> None:  # noqa: ANN001
        self.responses = list(responses)
        self.calls = 0

    async def complete_json(self, **kwargs) -> str:  # noqa: ANN003
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _batch(*probes: dict) -> str:
    return json.dumps({"probes": list(probes)})


_CONC_PROBE = {"instrument": "concentration", "level": "session", "metric": "gmv", "rationale": "checking session concentration"}
_EMPTY_BATCH = _batch()


async def test_kill_switch_is_a_pure_noop() -> None:
    client = _ScriptedClient([])
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client, enabled=False)
    assert result.disabled
    assert result.probes_executed == 0
    assert client.calls == 0


async def test_analyst_stops_when_it_proposes_zero_probes() -> None:
    client = _ScriptedClient([_EMPTY_BATCH])
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client)
    assert result.probes_executed == 0
    assert client.calls == 1  # only round 1 — no reason to ask again after "nothing to probe"


async def test_analyst_executes_a_successful_probe_and_produces_a_finding() -> None:
    client = _ScriptedClient([_batch(_CONC_PROBE), _EMPTY_BATCH])
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client)
    assert result.probes_executed == 1
    assert len(result.new_findings) == 1
    assert result.yield_rate == 1.0


async def test_analyst_never_exceeds_max_probes_across_rounds() -> None:
    round1 = _batch(*[_CONC_PROBE] * 4)
    round2 = _batch(*[_CONC_PROBE] * 4)  # would be 8 total; must be capped at 6
    client = _ScriptedClient([round1, round2])
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client)
    assert result.probes_executed == MAX_PROBES
    assert result.probes_executed <= MAX_PROBES


async def test_analyst_never_exceeds_max_rounds() -> None:
    # Every round proposes exactly 1 probe (well under the per-round budget),
    # so only MAX_ROUNDS calls should ever happen, not more.
    client = _ScriptedClient([_batch(_CONC_PROBE)] * 5)
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client)
    assert client.calls == MAX_ROUNDS
    assert result.rounds_used == MAX_ROUNDS


async def test_analyst_degrades_gracefully_on_malformed_response() -> None:
    from engine.llm.client import LmStudioError

    client = _ScriptedClient([LmStudioError("connection refused")])
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client)
    assert result.probes_executed == 0
    assert result.new_findings == []


async def test_analyst_logs_a_failed_probe_without_fabricating_a_finding() -> None:
    bad_probe = {"instrument": "decompose", "level": "product", "entity_id": "sku_lennon", "rationale": "check Lennon's own decomposition"}
    client = _ScriptedClient([_batch(bad_probe), _EMPTY_BATCH])
    result = await run_probe_loop([], build_sovella_gmv_metric_frame(), GMV_OBJECTIVE_CONTRACT, tenant_id=TENANT_ID, brief_type="gmv", client=client)
    assert result.probes_executed == 1
    assert result.new_findings == []  # no prior-period product data in the fixture -> instrument reports a gap
    assert result.probe_log[0].result_ok is False
    assert result.yield_rate == 0.0
