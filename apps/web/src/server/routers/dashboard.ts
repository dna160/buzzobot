import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getClientBySlug, getDashboard, recentSyncRuns } from '@tempo/db';
import { rangePreset } from '@tempo/core';
import { router, publicProcedure } from '../trpc.js';
import { DASHBOARD_ANCHOR_DATE } from '../../lib/constants.js';

const rangePresetSchema = z.enum(['7d', '28d', '30d', '90d']);

export const dashboardRouter = router({
  /**
   * The full client dashboard read-model for a preset window. The window is
   * anchored to a fixed "today" so the seeded demo always has data to show;
   * in production this anchor is simply the real current date.
   */
  get: publicProcedure
    .input(
      z.object({
        clientSlug: z.string().min(1),
        preset: rangePresetSchema.default('30d'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const client = await getClientBySlug(ctx.db, input.clientSlug);
      if (!client) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Client "${input.clientSlug}" not found` });
      }
      const range = rangePreset(input.preset, DASHBOARD_ANCHOR_DATE);
      const [data, syncs] = await Promise.all([
        getDashboard(ctx.db, client, range),
        recentSyncRuns(ctx.db, client.id, 4),
      ]);
      return { ...data, syncs };
    }),
});
