-- 0003_create_brief_table.sql
--
-- The rendered brief itself, written by the graph before the review
-- interrupt (status='pending_review') and updated after a human resumes it
-- (PRD §10). LangGraph's own checkpoint tables (insight.checkpoints,
-- insight.checkpoint_writes, ...) are created separately by
-- AsyncPostgresSaver.setup() — not hand-written here, since their shape is
-- LangGraph's to own and would drift from whatever version is installed.

CREATE TABLE IF NOT EXISTS insight.brief (
    id text PRIMARY KEY,
    run_id text NOT NULL UNIQUE,
    tenant_id text NOT NULL,
    brief_type text NOT NULL,
    status text NOT NULL DEFAULT 'pending_review',
    content jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brief_tenant_idx ON insight.brief (tenant_id);
CREATE INDEX IF NOT EXISTS brief_status_idx ON insight.brief (status);
