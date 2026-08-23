-- 0002_create_materiality_rankings.sql
--
-- PRD §6.5: "Persist the full ranked list including everything below the
-- cut — that is the only signal that later tells us the presets are
-- wrong." One row per (finding, section) considered, whether or not it was
-- selected for narration. Idempotent.

CREATE TABLE IF NOT EXISTS insight.materiality_rankings (
    id bigserial PRIMARY KEY,
    run_id text NOT NULL,
    tenant_id text NOT NULL,
    brief_type text NOT NULL,
    section_id integer NOT NULL,
    finding_id text NOT NULL,
    generator text NOT NULL,
    claim_frame text NOT NULL,
    rank integer NOT NULL,
    materiality double precision NOT NULL,
    included boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS materiality_rankings_run_idx ON insight.materiality_rankings (run_id);
CREATE INDEX IF NOT EXISTS materiality_rankings_tenant_idx ON insight.materiality_rankings (tenant_id);
