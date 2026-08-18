module.exports = {
  apps: [
    {
      name: 'tempo-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start apps/web -p 3000',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'tempo-sanitizer-cron',
      script: './packages/db/dist/scheduler.cjs',
      autorestart: true,
      watch: false,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
