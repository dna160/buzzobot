import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getClientBySlug, getDashboard, getHourlyDashboard, recentSyncRuns } from '@tempo/db';
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

  /**
   * The intraday read-model for one calendar date. Omit `date` to get the most
   * recent date that actually has data, so the view always lands on something.
   */
  hourly: publicProcedure
    .input(
      z.object({
        clientSlug: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const client = await getClientBySlug(ctx.db, input.clientSlug);
      if (!client) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Client "${input.clientSlug}" not found` });
      }
      const data = await getHourlyDashboard(ctx.db, client, input.date);
      if (!data) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No intraday data ingested for "${input.clientSlug}"`,
        });
      }
      const syncs = await recentSyncRuns(ctx.db, client.id, 4);
      return { ...data, syncs };
    }),
});
