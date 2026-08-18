import { listClients, triggerAutoSyncIfStale } from '@tempo/db';
import { loadTikTokConfig } from '@tempo/tiktok';
import { router, publicProcedure } from '../trpc.js';

/** How each provider should be described in the UI. */
const SOURCE_LABEL: Record<string, string> = {
  live: 'Live TikTok API',
  csv: 'TikTok Ads export',
  postgres: 'PostgreSQL Live Source',
  fixture: 'Fixture data · demo mode',
};

export const clientsRouter = router({
  /** All clients the current agency manages (unscoped until auth lands). */
  list: publicProcedure.query(async ({ ctx }) => {
    let clients = await listClients(ctx.db);
    if (clients.length === 0) {
      // If database is empty, perform blocking initial sync so client list renders immediately
      await triggerAutoSyncIfStale({ maxAgeMs: 0, blocking: true });
      clients = await listClients(ctx.db);
    } else {
      // Background non-blocking sync if stale (> 60s)
      triggerAutoSyncIfStale({ maxAgeMs: 60_000, blocking: false }).catch(() => {});
    }
    return clients;
  }),

  /**
   * Which data source is actually configured. Surfaced in the UI so a real
   * brand's numbers are never presented under a "demo mode" label.
   */
  dataSource: publicProcedure.query(() => {
    const { provider } = loadTikTokConfig();
    return { provider, label: SOURCE_LABEL[provider] ?? provider, isDemo: provider === 'fixture' };
  }),
});
