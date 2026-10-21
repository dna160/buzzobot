-- 0004_create_brief_edits.sql
--
-- Edit capture (Strategy Report PRD §11.4): when a reviewer changes a
-- section's text on the review page before approving, each change is stored
-- here with its normalized edit distance, so "did the AMs have to rewrite it?"
-- is a number with a monthly trend (target < 15% by the second month), not an
-- impression. The approved brief in insight.brief carries the edited text;
-- this table keeps what the engine wrote.

CREATE TABLE IF NOT EXISTS insight.brief_edits (
    id bigserial PRIMARY KEY,
    run_id text NOT NULL,
    tenant_id text NOT NULL,
    brief_type text NOT NULL,
    section_id text NOT NULL,
    path text NOT NULL,
    before_text text NOT NULL,
    after_text text NOT NULL,
    edit_distance double precision NOT NULL,
    narration_source text,
    editor text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brief_edits_run_idx ON insight.brief_edits (run_id);
CREATE INDEX IF NOT EXISTS brief_edits_type_month_idx ON insight.brief_edits (brief_type, created_at);
