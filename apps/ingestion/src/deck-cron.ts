import cron from 'node-cron';
import { pregenerateDecks, summarize } from './pregenerate-decks.js';

/**
 * The weekly deck pre-generation daemon (Brief Deck PRD §5).
 *
 * Runs alongside the sanitizer cron under the same process manager
 * (`ecosystem.config.cjs`). Default schedule is Monday 03:00 — after the
 * nightly sanitize at 02:00, so the decks it renders describe the data that
 * just landed, and before anyone opens the portal.
 *
 *     pnpm --filter @tempo/ingestion decks:cron        # daemon
 *     pnpm --filter @tempo/ingestion decks:cron --now  # run once, immediately
 */

const SCHEDULE = process.env.DECK_CRON_SCHEDULE ?? '0 3 * * 1';
const RUN_ON_STARTUP = process.argv.includes('--now');
const RUN_ONCE = process.argv.includes('--once');

let running = false;

async function run(trigger: 'Scheduled' | 'Startup'): Promise<void> {
  if (running) {
    console.warn(`[${new Date().toISOString()}] ⚠️ deck pre-generation still running; skipping ${trigger}.`);
    return;
  }
  running = true;
  console.log(`[${new Date().toISOString()}] 🎞️  ${trigger} deck pre-generation starting…`);
  try {
    const results = await pregenerateDecks();
    console.log(summarize(results));
    // A partial failure is reported, never thrown: the decks that did render
    // are still worth having, and the daemon must survive to try again.
    if (results.some((r) => !r.ok)) {
      console.warn(`[${new Date().toISOString()}] ⚠️ some decks failed — see above.`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ deck pre-generation failed:`, err);
  } finally {
    running = false;
  }
}

if (RUN_ONCE) {
  await run('Startup');
  process.exit(0);
}

if (!cron.validate(SCHEDULE)) {
  console.error(`❌ Invalid DECK_CRON_SCHEDULE: "${SCHEDULE}"`);
  process.exit(1);
}

console.log('====================================================');
console.log('🎞️  Tempo Brief Deck pre-generation daemon');
console.log(`📅 Schedule: "${SCHEDULE}"`);
console.log('💡 --now runs once on startup as well; --once runs and exits.');
console.log('====================================================');

cron.schedule(SCHEDULE, () => {
  void run('Scheduled');
});
if (RUN_ON_STARTUP) void run('Startup');

const shutdown = () => {
  console.log('\n🛑 Stopping deck pre-generation daemon…');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
