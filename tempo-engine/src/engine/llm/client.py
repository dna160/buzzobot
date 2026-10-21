"""LM Studio OpenAI-compatible client. PRD §7: Gemma 4 12B QAT, LM Studio at
`http://localhost:1234/v1`, structured output via `response_format`.

Plain HTTP against the OpenAI chat-completions wire format — no vendor SDK,
because LM Studio (and any other OpenAI-compatible local server) is not a
vendor to depend on, it's a swappable serving runtime (PRD's own framing:
"the serving runtime is swappable without touching brief code").

Strategy Report PRD §8.1 / §13 #2–#4:
- Configuration comes from `LM_STUDIO_URL`, `LM_STUDIO_MODEL`,
  `LM_STUDIO_MAX_TOKENS`, `LM_STUDIO_TIMEOUT_S`, `LM_STUDIO_CONCURRENCY`.
- `max_tokens` defaults to 8192 because Gemma 4's reasoning tokens count
  against it; `finish_reason == "length"` with no content is a retryable
  `LmStudioTruncated`, not a schema failure.
- One process-wide semaphore (default 1) and one shared HTTP client, so a
  cron run and an AM click queue for the single GPU instead of thrashing it.
- Transport failures get their own retries with backoff and never consume an
  agent's quality retry.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from dataclasses import dataclass, field

import httpx

TRANSPORT_RETRIES = 2
TRANSPORT_BACKOFF_S = (1.0, 3.0)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class LmStudioConfig:
    base_url: str = "http://localhost:1234/v1"
    model: str = "google/gemma-4-12b"
    timeout_s: float = 180.0
    temperature: float = 0.3
    max_tokens: int = 8192
    concurrency: int = 1
    #: Send `reasoning_effort` when an agent asks for thinking off/on. LM Studio
    #: accepts the field; a server that rejects unknown fields can turn it off.
    reasoning_toggle: bool = True

    @classmethod
    def from_env(cls) -> LmStudioConfig:
        return cls(
            base_url=os.environ.get("LM_STUDIO_URL") or cls.base_url,
            model=os.environ.get("LM_STUDIO_MODEL") or cls.model,
            timeout_s=_env_float("LM_STUDIO_TIMEOUT_S", cls.timeout_s),
            max_tokens=_env_int("LM_STUDIO_MAX_TOKENS", cls.max_tokens),
            concurrency=max(1, _env_int("LM_STUDIO_CONCURRENCY", cls.concurrency)),
            reasoning_toggle=os.environ.get("LM_STUDIO_REASONING_TOGGLE", "true").strip().lower() not in ("false", "0"),
        )


@dataclass
class _LoopShared:
    semaphore: asyncio.Semaphore
    http: httpx.AsyncClient


# Keyed by event loop: an asyncio primitive or an httpx pool is bound to the
# loop it was first used on, and tests (and scripts) run several loops in one
# process. The API server runs exactly one, so in production this is a single
# process-wide semaphore and client.
_SHARED: dict[int, _LoopShared] = {}


def _shared(config: LmStudioConfig) -> _LoopShared:
    key = id(asyncio.get_running_loop())
    entry = _SHARED.get(key)
    if entry is None or entry.http.is_closed:
        entry = _LoopShared(
            semaphore=asyncio.Semaphore(config.concurrency),
            http=httpx.AsyncClient(timeout=config.timeout_s),
        )
        _SHARED[key] = entry
    return entry


def stable_seed(*parts: object) -> int:
    """PRD §8.1: `seed = stable_hash(run_id, agent, section)` — the same run
    re-narrated draws the same tokens, so a review diff is a prompt change,
    not sampling noise."""
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(digest[:8], 16)


@dataclass
class CallStats:
    """Per-client counters the strategy full tier reports in `meta.eval`."""

    calls: int = 0
    transport_retries: int = 0
    truncated: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    seconds: float = 0.0
    by_agent: dict[str, int] = field(default_factory=dict)


class LmStudioClient:
    def __init__(self, config: LmStudioConfig | None = None) -> None:
        self.config = config or LmStudioConfig.from_env()
        self.stats = CallStats()

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        json_schema: dict,
        schema_name: str,
        temperature: float | None = None,
        seed: int | None = None,
        thinking: bool | None = None,
        max_tokens: int | None = None,
        agent: str | None = None,
    ) -> str:
        """One chat-completion call constrained to `json_schema` via
        `response_format`. Returns the raw content string — parsing and
        validation are the caller's job (the schema gate), not this
        client's, so a malformed reply is a gate failure, not a client
        exception swallowed here."""
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        payload: dict = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": json_schema, "strict": True},
            },
            "temperature": temperature if temperature is not None else self.config.temperature,
            "max_tokens": max_tokens or self.config.max_tokens,
            "stream": False,
        }
        if seed is not None:
            payload["seed"] = seed
        if thinking is not None and self.config.reasoning_toggle:
            payload["reasoning_effort"] = "low" if thinking else "none"

        shared = _shared(self.config)
        loop = asyncio.get_running_loop()
        res: httpx.Response | None = None
        async with shared.semaphore:
            started = loop.time()
            try:
                for attempt in range(TRANSPORT_RETRIES + 1):
                    try:
                        res = await shared.http.post(url, json=payload, timeout=self.config.timeout_s)
                        break
                    except httpx.RequestError as exc:
                        if attempt >= TRANSPORT_RETRIES:
                            raise LmStudioUnreachable(f"could not reach LM Studio at {url}: {exc}") from exc
                        self.stats.transport_retries += 1
                        await asyncio.sleep(TRANSPORT_BACKOFF_S[min(attempt, len(TRANSPORT_BACKOFF_S) - 1)])
            finally:
                self.stats.seconds += loop.time() - started
        self.stats.calls += 1
        if agent:
            self.stats.by_agent[agent] = self.stats.by_agent.get(agent, 0) + 1

        assert res is not None
        if res.status_code != 200:
            raise LmStudioError(f"LM Studio returned {res.status_code}: {res.text[:300]}")

        data = res.json()
        usage = data.get("usage") or {}
        self.stats.prompt_tokens += int(usage.get("prompt_tokens") or 0)
        self.stats.completion_tokens += int(usage.get("completion_tokens") or 0)
        choices = data.get("choices") or []
        choice = choices[0] if choices else {}
        content = (choice.get("message") or {}).get("content")
        finish = choice.get("finish_reason")
        if finish == "length":
            self.stats.truncated += 1
        if not content:
            if finish == "length":
                raise LmStudioTruncated("LM Studio stopped at max_tokens before writing any content")
            raise LmStudioError("LM Studio returned no content")
        return strip_to_json(content)


class LmStudioError(Exception):
    pass


class LmStudioUnreachable(LmStudioError):
    pass


class LmStudioTruncated(LmStudioError):
    """`finish_reason == "length"` with empty content: reasoning ate the
    budget. Retryable like any other quality failure."""


def strip_to_json(raw: str) -> str:
    """Defensive unwrap for a local model that fences its JSON or prefaces
    it with prose despite `response_format` — same pattern the Tempo web
    app's own LM Studio provider uses (packages/reports/src/narrative/
    providers/openai-compatible.ts's `stripToJson`)."""
    trimmed = raw.strip()
    if trimmed.startswith("```"):
        lines = trimmed.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        trimmed = "\n".join(lines).strip()
    start = trimmed.find("{")
    end = trimmed.rfind("}")
    if start != -1 and end > start:
        return trimmed[start : end + 1]
    return trimmed
