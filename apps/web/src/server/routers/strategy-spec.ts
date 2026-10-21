import { TRPCError } from '@trpc/server';
import { z, ZodError } from 'zod';
import {
  deleteStrategySpec,
  getClientBySlug,
  getStrategySpec,
  listMarketScopeAccounts,
  upsertStrategySpec,
} from '@tempo/db';
import {
  EMPTY_STRATEGY_SPEC,
  GOAL_KINDS,
  GOAL_STAGES,
  SHARE_GOAL_METRICS,
  StrategySpecError,
  parseStrategySpec,
  strategySpecFromRow,
  strategySpecToRow,
} from '@tempo/reports';
import { router, publicProcedure } from '../trpc.js';

/**
 * The Strategy Report settings API (PRD §9.3 card 1, §9.5).
 *
 * Every rule lives in `@tempo/reports` (`parseStrategySpec`), as the deck's
 * rules do — this router only resolves the client and maps errors: a malformed
 * payload is a 400, a well-formed spec the data cannot support (a cost per new
 * Conversion goal, someone else's TTMS account) is a 422 carrying the fields.
 */

/** Today in Asia/Jakarta (fixed UTC+7), the day an AM's "deadline after today" means. */
const todayJakarta = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function requireClient(db: Parameters<typeof getClientBySlug>[0], slug: string) {
  const client = await getClientBySlug(db, slug);
  if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: `Client "${slug}" not found` });
  return client;
}

export const strategySpecRouter = router({
  /**
   * The stored spec (or the empty default), the client's TTMS accounts for the
   * picker, and the goal vocabulary the form may offer. A client with no
   * mirrored TTMS account is not eligible for the report (PRD §7.1).
   */
  get: publicProcedure.input(z.object({ slug: z.string().min(1) })).query(async ({ ctx, input }) => {
    const client = await requireClient(ctx.db, input.slug);
    const [stored, accounts] = await Promise.all([
      getStrategySpec(ctx.db, client.id),
      listMarketScopeAccounts(ctx.db, client.id),
    ]);
    return {
      client: { id: client.id, name: client.name, slug: client.slug, northStar: client.northStar },
      eligible: accounts.length > 0,
      accounts: accounts.map((a) => ({ ...a, syncedAt: a.syncedAt.toISOString() })),
      spec: stored ? strategySpecFromRow(stored) : EMPTY_STRATEGY_SPEC,
      isStored: stored !== null,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
      goalOptions: { kinds: GOAL_KINDS, stages: GOAL_STAGES, shareMetrics: SHARE_GOAL_METRICS },
    };
  }),

  save: publicProcedure
    .input(z.object({ slug: z.string().min(1), spec: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireClient(ctx.db, input.slug);
      const accounts = await listMarketScopeAccounts(ctx.db, client.id);

      let spec;
      try {
        spec = parseStrategySpec(input.spec, {
          today: todayJakarta(),
          accountIds: accounts.map((a) => a.ttmsAccountId),
        });
      } catch (error) {
        if (error instanceof StrategySpecError) {
          throw new TRPCError({ code: 'UNPROCESSABLE_CONTENT', message: error.message, cause: error });
        }
        if (error instanceof ZodError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
        }
        throw error;
      }

      // No auth yet (Phase 2): `updatedBy` stays null until there is a user to name.
      await upsertStrategySpec(ctx.db, client.id, strategySpecToRow(spec), null);
      return { ok: true as const, spec };
    }),

  /** Back to defaults: inferred class, no goal, no fees. */
  reset: publicProcedure.input(z.object({ slug: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const client = await requireClient(ctx.db, input.slug);
    await deleteStrategySpec(ctx.db, client.id);
    return { ok: true as const, spec: EMPTY_STRATEGY_SPEC };
  }),
});
