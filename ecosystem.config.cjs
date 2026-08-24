const path = require('path');

module.exports = {
  apps: [
    {
      name: 'tempo-web',
      cwd: path.resolve(__dirname, 'apps/web'),
      script: path.resolve(__dirname, 'apps/web/node_modules/next/dist/bin/next'),
      args: 'dev -p 3001',
      autorestart: true,
      watch: false,
      env: {
        PORT: 3001,
      },
    },
    {
      name: 'tempo-sanitizer-cron',
      cwd: __dirname,
      script: path.resolve(__dirname, './packages/db/dist/scheduler.cjs'),
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // Weekly Brief Deck pre-generation (Brief Deck PRD §5). The full tier
      // costs minutes per deck, so it runs overnight — after the 02:00
      // sanitize, before anyone opens the portal — and stores each rendered
      // PDF against a `report_runs` row. The Monday download is then a file
      // read rather than a twenty-minute wait.
      //
      // It calls the app's own report API as an external caller, so it needs
      // DECK_CRON_API_KEY to be one of REPORT_API_KEYS.
      name: 'tempo-deck-cron',
      cwd: path.resolve(__dirname, 'apps/ingestion'),
      script: 'pnpm',
      args: 'run decks:cron',
      autorestart: true,
      watch: false,
      restart_delay: 10000,
    },
    {
      // Tempo Intelligence Engine — a Python service, co-located here under
      // tempo-engine/ (its own git history didn't have a home yet, so it
      // was copied in as source rather than kept as a separate repo) that
      // generates the Awareness/GMV/Install briefs apps/web/src/app/api/
      // reports/[slug]/brief/[objective]/route.ts calls out to. Its own
      // .venv is expected to already exist (`uv sync` from tempo-engine/,
      // see that folder's README) — this just runs it, it doesn't set it up.
      name: 'tempo-engine',
      cwd: path.resolve(__dirname, 'tempo-engine'),
      script: path.resolve(__dirname, 'tempo-engine/.venv/Scripts/python.exe'),
      args: 'scripts/run_api.py --host 127.0.0.1 --port 8001',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
    },
  ],
};