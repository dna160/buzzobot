import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import cron from 'node-cron';
import { fetchSanitizeAndSeed } from '../ingest/sanitize.js';

// Auto-load root .env if not already loaded into process.env
function loadEnvFile() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const envPath = resolve(dir, '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadEnvFile();

const CRON_SCHEDULE = process.env.SANITIZE_CRON_SCHEDULE ?? '0 2 * * *';
const RUN_ON_STARTUP = process.argv.includes('--now');

let isRunning = false;

async function executeSanitizeTask(triggerType: 'Scheduled' | 'Startup') {
  if (isRunning) {
    console.warn(`[${new Date().toISOString()}] ⚠️ Previous sanitize job is still running. Skipping ${triggerType} trigger.`);
    return;
  }

  isRunning = true;
  console.log(`[${new Date().toISOString()}] ⏰ Starting ${triggerType} sanitize & seed task...`);

  try {
    await fetchSanitizeAndSeed({ closeOnComplete: false });
    console.log(`[${new Date().toISOString()}] ✅ ${triggerType} sanitize task completed successfully.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ ${triggerType} sanitize task failed:`, err);
  } finally {
    isRunning = false;
  }
}

console.log('====================================================');
console.log('🤖 Tempo Data Sanitizer Daemon Initialized');
console.log(`📅 Cron Schedule: "${CRON_SCHEDULE}" (Everyday at 2:00 AM)`);
console.log(`💡 Run with --now to trigger an immediate initial sync.`);
console.log('====================================================');

if (!cron.validate(CRON_SCHEDULE)) {
  console.error(`❌ Invalid cron expression: "${CRON_SCHEDULE}"`);
  process.exit(1);
}

// Schedule the daily cron job at 2:00 AM
cron.schedule(CRON_SCHEDULE, () => {
  executeSanitizeTask('Scheduled');
});

// Run immediately if --now flag is passed
if (RUN_ON_STARTUP) {
  executeSanitizeTask('Startup');
}

// Handle graceful shutdown
const shutdown = () => {
  console.log('\n🛑 Shutdown signal received. Stopping scheduler daemon...');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
