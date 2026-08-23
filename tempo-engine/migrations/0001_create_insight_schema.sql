-- 0001_create_insight_schema.sql
--
-- The engine's own schema, per PRD §1 rule 2: "The engine owns the insight.*
-- schema entirely. Tempo reads it; never writes it." Run against the same
-- Postgres database Tempo uses (the database itself is named "tempo"; there
-- is no schema by that name — see tempo_read.py's module docstring). No
-- tables yet: B1-B5 add insight.finding / insight.brief / insight.run /
-- insight.brand_context / insight.diagnostic_index as each milestone needs
-- them, rather than guessing their shape now.
--
-- Run as an admin/superuser role (this creates a schema, which the
-- restricted engine role must not have CREATE on the database level to do
-- itself). Idempotent — safe to re-run.

CREATE SCHEMA IF NOT EXISTS insight;
