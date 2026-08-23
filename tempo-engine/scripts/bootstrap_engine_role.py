"""One-time (idempotent) setup: create the `tempo_engine` Postgres role with
SELECT-only on `public.*` and full rights on `insight.*`, per PRD §1.

Run with an admin connection string (Tempo's own superuser credentials —
never checked into this repo):

    TEMPO_ADMIN_DATABASE_URL="postgres://postgres:...@localhost:5433/tempo" \
        python scripts/bootstrap_engine_role.py

On success, writes the generated engine role's own connection string to
`.env` (gitignored) as `TEMPO_ENGINE_DATABASE_URL`, so `tempo_read.py`'s
functions and the boundary-verification test can use it immediately.

Idempotent: re-running rotates the role's password (a fresh random one each
time) and re-applies every grant — safe to run again after schema changes,
never leaves stale privileges from an earlier version of this script.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import sys
from pathlib import Path

import asyncpg

from engine.ports.tempo_read import parse_database_url

ENGINE_ROLE = "tempo_engine"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


async def bootstrap(admin_url: str) -> str:
    admin_conn = await asyncpg.connect(**parse_database_url(admin_url))
    try:
        password = secrets.token_urlsafe(24)

        role_exists = await admin_conn.fetchval(
            "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1", ENGINE_ROLE
        )
        if role_exists:
            await admin_conn.execute(f"ALTER ROLE {ENGINE_ROLE} WITH LOGIN PASSWORD '{password}'")
        else:
            await admin_conn.execute(
                f"CREATE ROLE {ENGINE_ROLE} WITH LOGIN PASSWORD '{password}'"
            )

        await admin_conn.execute("CREATE SCHEMA IF NOT EXISTS insight")

        # Read-only on Tempo's tables. No CREATE on public — the engine must
        # never be able to add a table there either.
        await admin_conn.execute(f"GRANT USAGE ON SCHEMA public TO {ENGINE_ROLE}")
        await admin_conn.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {ENGINE_ROLE}")
        await admin_conn.execute(
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {await _table_owner(admin_conn)} "
            f"IN SCHEMA public GRANT SELECT ON TABLES TO {ENGINE_ROLE}"
        )

        # Full rights on its own schema.
        await admin_conn.execute(f"GRANT ALL PRIVILEGES ON SCHEMA insight TO {ENGINE_ROLE}")
        await admin_conn.execute(
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {ENGINE_ROLE} IN SCHEMA insight "
            f"GRANT ALL ON TABLES TO {ENGINE_ROLE}"
        )

        parsed = parse_database_url(admin_url)
        return f"postgres://{ENGINE_ROLE}:{password}@{parsed['host']}:{parsed['port']}/{parsed['database']}"
    finally:
        await admin_conn.close()


async def _table_owner(admin_conn: asyncpg.Connection) -> str:
    """The role that owns `public.clients` — future tables it creates in
    `public` should also auto-grant SELECT to the engine role. Falls back to
    `postgres` if the table doesn't exist yet (a fresh database)."""
    owner = await admin_conn.fetchval(
        "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'clients'"
    )
    return owner or "postgres"


def _write_env(engine_url: str) -> None:
    lines = []
    if ENV_FILE.exists():
        lines = [
            line
            for line in ENV_FILE.read_text().splitlines()
            if not line.startswith("TEMPO_ENGINE_DATABASE_URL=")
        ]
    lines.append(f"TEMPO_ENGINE_DATABASE_URL={engine_url}")
    ENV_FILE.write_text("\n".join(lines) + "\n")


async def main() -> None:
    admin_url = os.environ.get("TEMPO_ADMIN_DATABASE_URL")
    if not admin_url:
        print("TEMPO_ADMIN_DATABASE_URL is required (Tempo's own admin connection string).", file=sys.stderr)
        raise SystemExit(1)

    engine_url = await bootstrap(admin_url)
    _write_env(engine_url)
    print(f"tempo_engine role ready. Wrote TEMPO_ENGINE_DATABASE_URL to {ENV_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
