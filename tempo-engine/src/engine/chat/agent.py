"""`run_chat` — the tool loop (PRD §6.1, §8.3, §9).

A turn is: system prompt + history → Qwen with the allowed tools → run any tool
calls (native `tool_calls`, or an inline `<tool_call>` block Qwen left in the
content) → feed results back → repeat until the model answers in prose → strip
reasoning → number-check. One gate retry on an orphan; then the reply is
returned verified or flagged. At most 6 model calls and 8 tool calls per turn;
at the cap the tools are withdrawn and the model answers with what it has.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from time import perf_counter

from engine.chat.data import client_today
from engine.chat.gate import check_reply, clean_reply
from engine.chat.prompts import PROMPT_VERSION, gate_feedback, system_prompt
from engine.chat.scope import ChatScope
from engine.chat.tools import ToolContext, run_tool, tool_specs
from engine.llm.client import LmStudioClient, LmStudioTruncated

MAX_MODEL_CALLS = 6
MAX_TOOL_CALLS = 8
HARD_ROUNDS = 10
HISTORY_MESSAGES = 12
MESSAGE_CHARS = 4000

_INLINE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL | re.IGNORECASE)
_TOOLS_WITHDRAWN = (
    "Batas pemakaian alat tercapai untuk giliran ini. Jawab sekarang dengan data yang sudah Anda peroleh, "
    "tanpa memanggil alat lagi."
)


@dataclass
class ChatResult:
    reply: str
    verified: bool
    unverified_numerals: list[str]
    tool_calls: list[dict] = field(default_factory=list)
    tool_outputs: list[dict] = field(default_factory=list)
    #: Clients the turn's tools resolved to, in first-touch order.
    clients: list[ChatScope] = field(default_factory=list)
    #: Reports `client_report` reused or generated this turn (`ReportRef.to_json()`).
    reports: list[dict] = field(default_factory=list)
    rounds: int = 0
    gate_attempts: int = 0
    model: str = ""
    prompt_version: str = PROMPT_VERSION
    duration_s: float = 0.0
    prompt_tokens: int = 0
    completion_tokens: int = 0


def _trim(history: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in history[-HISTORY_MESSAGES:]:
        role = m.get("role")
        content = (m.get("content") or "")[:MESSAGE_CHARS]
        if role in ("user", "assistant"):
            out.append({"role": role, "content": content})
    return out


def _extract_calls(message: dict) -> list[tuple[str, dict, str]]:
    """Native OpenAI `tool_calls` first; else parse inline `<tool_call>{…}</tool_call>`
    blocks out of the content (LM Studio sometimes leaves Qwen's there, §8.3)."""
    calls: list[tuple[str, dict, str]] = []
    for i, tc in enumerate(message.get("tool_calls") or []):
        fn = tc.get("function") or {}
        name = fn.get("name")
        if not name:
            continue
        calls.append((name, _parse_args(fn.get("arguments")), tc.get("id") or f"call_{i}"))
    if calls:
        return calls
    for i, m in enumerate(_INLINE.finditer(message.get("content") or "")):
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        name = obj.get("name")
        if name:
            calls.append((name, _parse_args(obj.get("arguments") or obj.get("args")), f"inline_{i}"))
    return calls


def _parse_args(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _assistant_toolcall_msg(content: str, calls: list[tuple[str, dict, str]]) -> dict:
    return {
        "role": "assistant",
        "content": content or "",
        "tool_calls": [
            {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
            for (name, args, cid) in calls
        ],
    }


async def run_chat(
    *,
    client: LmStudioClient,
    ctx: ToolContext,
    allowed: tuple[str, ...],
    history: list[dict],
    prompt_version: str = PROMPT_VERSION,
    focus: ChatScope | None = None,
) -> ChatResult:
    if not history or history[-1].get("role") != "user":
        raise ValueError("the last message must be from the user")

    started = perf_counter()
    base_prompt_tokens = client.stats.prompt_tokens
    base_completion_tokens = client.stats.completion_tokens

    today = client_today(ctx.workspace.timezone)
    messages: list[dict] = [{"role": "system", "content": system_prompt(ctx.workspace, today, focus)}]
    messages.extend(_trim(history))
    user_texts = [m["content"] for m in history if m.get("role") == "user"]
    prior_replies = [m["content"] for m in history if m.get("role") == "assistant"]
    specs = tool_specs(allowed)

    tool_calls_log: list[dict] = []
    tool_outputs_log: list[dict] = []
    model_calls = 0
    tool_calls_made = 0
    gate_attempts = 0
    withdrawn = False
    reply = ""
    orphans: list[str] = []

    for _ in range(HARD_ROUNDS):
        at_cap = model_calls >= MAX_MODEL_CALLS or tool_calls_made >= MAX_TOOL_CALLS
        use_tools = None if at_cap else specs
        if at_cap and not withdrawn:
            messages.append({"role": "user", "content": _TOOLS_WITHDRAWN})
            withdrawn = True
        try:
            message = await client.chat(messages=messages, tools=use_tools, reasoning_effort=client.config.reasoning_effort)
        except LmStudioTruncated:
            messages.append({"role": "user", "content": "Jawab singkat dan langsung."})
            model_calls += 1
            continue
        model_calls += 1

        calls = _extract_calls(message) if use_tools else []
        if calls:
            messages.append(_assistant_toolcall_msg(message.get("content") or "", calls))
            for name, args, cid in calls:
                if tool_calls_made >= MAX_TOOL_CALLS:
                    messages.append({"role": "tool", "tool_call_id": cid, "content": _TOOLS_WITHDRAWN})
                    continue
                res = await run_tool(ctx, name, args)
                tool_calls_made += 1
                tool_calls_log.append({"name": name, "args": args, "ok": res.ok})
                tool_outputs_log.append({"name": name, "output": res.output})
                messages.append({"role": "tool", "tool_call_id": cid, "content": res.output})
            continue

        candidate = clean_reply(message.get("content") or "")
        if not candidate and message.get("finish_reason") == "length":
            messages.append({"role": "user", "content": "Jawab singkat dan langsung."})
            continue
        reply = candidate
        orphans = check_reply(
            reply,
            tool_outputs=[o["output"] for o in tool_outputs_log],
            user_texts=user_texts,
            prior_replies=prior_replies,
        )
        if orphans and gate_attempts == 0:
            gate_attempts = 1
            messages.append({"role": "assistant", "content": reply})
            messages.append({"role": "user", "content": gate_feedback(orphans)})
            continue
        break

    return ChatResult(
        reply=reply,
        verified=not orphans,
        unverified_numerals=orphans,
        tool_calls=tool_calls_log,
        tool_outputs=tool_outputs_log,
        clients=list(ctx.touched.values()),
        reports=[r.to_json() for r in ctx.reports],
        rounds=model_calls,
        gate_attempts=gate_attempts,
        model=client.config.model,
        prompt_version=prompt_version,
        duration_s=round(perf_counter() - started, 3),
        prompt_tokens=client.stats.prompt_tokens - base_prompt_tokens,
        completion_tokens=client.stats.completion_tokens - base_completion_tokens,
    )
