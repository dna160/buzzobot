import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { acceptStrategyAction, getClientBySlug, listStrategyActions, snoozeStrategyAction } from '@tempo/db';
import { router, publicProcedure } from '../trpc.js';

/**
 * The Strategy Report's "Tindakan" card (PRD §9.3 card 3, §5.6): list a
 * client's proposed and logged actions, accept one ("Terima") or snooze it
 * ("Nanti dulu"). Accepting starts the kill-signal clock; the next run measures
 * it (P5). A click on an action already accepted or snoozed is a 409, not a
 * silent no-op, so a second tab cannot think it changed something.
 */

const todayJakarta = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function requireClient(db: Parameters<typeof getClientBySlug>[0], slug: string) {
  const client = await getClientBySlug(db, slug);
  if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: `Client "${slug}" not found` });
  return client;
}

const ActionRef = z.object({ slug: z.string().min(1), id: z.string().uuid() });

export const strategyActionRouter = router({
  list: publicProcedure
    .input(z.object({ slug: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const client = await requireClient(ctx.db, input.slug);
      return listStrategyActions(ctx.db, client.id, { limit: input.limit });
    }),

  accept: publicProcedure.input(ActionRef).mutation(async ({ ctx, input }) => {
    const client = await requireClient(ctx.db, input.slug);
    // No auth yet (Phase 2): `acceptedBy` stays null until there is a user to name.
    const row = await acceptStrategyAction(ctx.db, client.id, input.id, { acceptedBy: null, startedAt: todayJakarta() });
    if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Action is not open for acceptance' });
    return row;
  }),

  snooze: publicProcedure.input(ActionRef).mutation(async ({ ctx, input }) => {
    const client = await requireClient(ctx.db, input.slug);
    const row = await snoozeStrategyAction(ctx.db, client.id, input.id);
    if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Only a proposed action can be snoozed' });
    return row;
  }),
});
