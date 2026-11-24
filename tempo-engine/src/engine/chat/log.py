"""`insight.chat_turns` — one row per turn, for audit and evals (PRD §9.4).

Created idempotently at API start-up (the same pattern as `ensure_edits_schema`)
and by migration `0005_create_chat_turns.sql`. pass@1 and the verified rate are
computed from these rows (`gate_attempts = 0`), per `prompt_version` (§13.3). A
failed log write never fails a turn — the answer was already produced.
"""

from __future__ import annotations

import json
import sys

import asyncpg

from engine.chat.agent import ChatResult
from engine.chat.scope import ChatScope, Principal


async def ensure_chat_schema(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS insight.chat_turns (
            id bigserial PRIMARY KEY,
            conversation_id text NOT NULL,
            tenant_id text NOT NULL,
            client_slug text NOT NULL,
            principal jsonb NOT NULL,
            question text NOT NULL,
            reply text NOT NULL,
            verified boolean NOT NULL,
            unverified_numerals jsonb NOT NULL DEFAULT '[]'::jsonb,
            tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,
            tool_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
            model text NOT NULL,
            prompt_version text NOT NULL,
            rounds integer NOT NULL DEFAULT 0,
            gate_attempts integer NOT NULL DEFAULT 0,
            duration_s double precision NOT NULL DEFAULT 0,
            prompt_tokens integer NOT NULL DEFAULT 0,
            completion_tokens integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS chat_turns_conversation_idx ON insight.chat_turns (conversation_id)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS chat_turns_tenant_idx ON insight.chat_turns (tenant_id, created_at)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS chat_turns_version_idx ON insight.chat_turns (prompt_version, gate_attempts)"
    )


async def record_turn(
    conn: asyncpg.Connection,
    *,
    conversation_id: str,
    scope: ChatScope,
    principal: Principal,
    question: str,
    result: ChatResult,
) -> None:
    """Best-effort: a logging failure is swallowed (printed to stderr), never
    raised, so audit never costs a user their answer."""
    try:
        await conn.execute(
            """
            INSERT INTO insight.chat_turns
                (conversation_id, tenant_id, client_slug, principal, question, reply, verified,
                 unverified_numerals, tool_calls, tool_outputs, model, prompt_version, rounds,
                 gate_attempts, duration_s, prompt_tokens, completion_tokens)
            VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17)
            """,
            conversation_id,
            scope.tenant_id,
            scope.client_slug,
            json.dumps(principal.to_json()),
            question,
            result.reply,
            result.verified,
            json.dumps(result.unverified_numerals),
            json.dumps(result.tool_calls),
            json.dumps(result.tool_outputs),
            result.model,
            result.prompt_version,
            result.rounds,
            result.gate_attempts,
            result.duration_s,
            result.prompt_tokens,
            result.completion_tokens,
        )
    except Exception as exc:  # noqa: BLE001 - audit must never fail a turn
        print(f"[chat] failed to record turn: {type(exc).__name__}: {exc}", file=sys.stderr)
