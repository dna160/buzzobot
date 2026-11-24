-- 0005_create_chat_turns.sql
--
-- Tempo Chat (C1) audit log (PRD §9.4): one row per turn, for disputes and for
-- the eval gates (pass@1 and the verified rate are computed from these rows
-- where gate_attempts = 0, per prompt_version; §13.3). Also created idempotently
-- at API start-up by engine.chat.log.ensure_chat_schema() — the same belt-and-
-- braces pattern as insight.brief_edits (0004).
--
-- `principal` records WHO asked on every turn (PRD §10.1): in C1 it is only
-- {kind, key_id}; C2 fills in user_id/role/organization_id without a migration.
-- `tool_outputs` is kept so a disputed answer can be traced to the exact facts
-- the model was shown. Retention: PRD Q5 (default 180 days, then aggregate).

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
);

CREATE INDEX IF NOT EXISTS chat_turns_conversation_idx ON insight.chat_turns (conversation_id);
CREATE INDEX IF NOT EXISTS chat_turns_tenant_idx ON insight.chat_turns (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS chat_turns_version_idx ON insight.chat_turns (prompt_version, gate_attempts);
