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
      // Tempo Intelligence Engine — a separate Python service (D:\tempo-engine,
      // sibling repo) that generates the Awareness/GMV/Install briefs
      // apps/web/src/app/api/reports/[slug]/brief/[objective]/route.ts calls
      // out to. Its own .venv is expected to already exist (see that repo's
      // README) — this just runs it, it doesn't set it up.
      name: 'tempo-engine',
      cwd: path.resolve(__dirname, '../tempo-engine'),
      script: path.resolve(__dirname, '../tempo-engine/.venv/Scripts/python.exe'),
      args: 'scripts/run_api.py --host 127.0.0.1 --port 8001',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
    },
  ],
};