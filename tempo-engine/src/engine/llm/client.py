"""LM Studio OpenAI-compatible client. PRD §7: Gemma 4 12B QAT, LM Studio at
`http://localhost:1234/v1`, structured output via `response_format`.

Plain HTTP against the OpenAI chat-completions wire format — no vendor SDK,
because LM Studio (and any other OpenAI-compatible local server) is not a
vendor to depend on, it's a swappable serving runtime (PRD's own framing:
"the serving runtime is swappable without touching brief code").
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class LmStudioConfig:
    base_url: str = "http://localhost:1234/v1"
    model: str = "google/gemma-4-12b"
    timeout_s: float = 120.0
    temperature: float = 0.3
    max_tokens: int = 4096


class LmStudioClient:
    def __init__(self, config: LmStudioConfig | None = None) -> None:
        self.config = config or LmStudioConfig()

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        json_schema: dict,
        schema_name: str,
        temperature: float | None = None,
    ) -> str:
        """One chat-completion call constrained to `json_schema` via
        `response_format`. Returns the raw content string — parsing and
        validation are the caller's job (the schema gate), not this
        client's, so a malformed reply is a gate failure, not a client
        exception swallowed here."""
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        payload = {
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
            "max_tokens": self.config.max_tokens,
            "stream": False,
        }

        async with httpx.AsyncClient(timeout=self.config.timeout_s) as client:
            try:
                res = await client.post(url, json=payload)
            except httpx.RequestError as exc:
                raise LmStudioUnreachable(f"could not reach LM Studio at {url}: {exc}") from exc

        if res.status_code != 200:
            raise LmStudioError(f"LM Studio returned {res.status_code}: {res.text[:300]}")

        data = res.json()
        choices = data.get("choices") or []
        content = choices[0].get("message", {}).get("content") if choices else None
        if not content:
            raise LmStudioError("LM Studio returned no content")
        return strip_to_json(content)


class LmStudioError(Exception):
    pass


class LmStudioUnreachable(LmStudioError):
    pass


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
