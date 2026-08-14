module.exports = {
  apps: [
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
