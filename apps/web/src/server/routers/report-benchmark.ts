import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getClientBySlug, listBenchmarks, upsertBenchmark } from '@tempo/db';
import { router, publicProcedure } from '../trpc.js';
import { autoPopulateBenchmarksFromIndustryPeers } from '../../lib/industry-peer-benchmark.js';

/**
 * Benchmark editor API for the Template Report ("Result Metric vs Benchmark",
 * §3, and the funnel "Proporsi Budget" ideal ranges, §2). Every value here is
 * either a target an AM typed in for a real negotiated number, or (via
 * `autoPopulate`) a real average pulled from comparable accounts in
 * Buzzohero's own database — never invented.
 */

// Section/metric keys are north-star specific (see BENCHMARK_LAYOUT in @tempo/core:
// GMV uses funnel-stage keys, Awareness/Install use their own sections), so
// these are validated as well-formed keys rather than a closed enum.
const KEY = /^[a-z0-9_]{1,40}$/;
const ObjectiveInput = z.string().regex(KEY);
const MetricInput = z.string().regex(KEY);
const DirectionInput = z.enum(['higher_is_better', 'lower_is_better']);

async function requireClient(db: Parameters<typeof getClientBySlug>[0], slug: string) {
  const client = await getClientBySlug(db, slug);
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Client "${slug}" not found` });
  }
  return client;
}

export const reportBenchmarkRouter = router({
  /** Every benchmark this client has, for the editor's grid. */
  list: publicProcedure.input(z.object({ slug: z.string().min(1) })).query(async ({ ctx, input }) => {
    const client = await requireClient(ctx.db, input.slug);
    return listBenchmarks(ctx.db, client.id);
  }),

  /** Upsert one (objective, metric) target. */
  save: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        objective: ObjectiveInput,
        metric: MetricInput,
        targetValue: z.number().finite(),
        comparisonDirection: DirectionInput,
        updatedBy: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await requireClient(ctx.db, input.slug);
      await upsertBenchmark(ctx.db, {
        clientId: client.id,
        objective: input.objective,
        metric: input.metric,
        targetValue: input.targetValue,
        comparisonDirection: input.comparisonDirection,
        updatedBy: input.updatedBy,
      });
      return { ok: true as const };
    }),

  /**
   * Preview-only — infers this client's industry via Gemma, matches real
   * comparable accounts in Buzzohero's database, and returns their averaged
   * metrics. Does NOT write to `report_benchmarks`; the client pre-fills the
   * editor's draft values from this and the AM still clicks "Simpan
   * Benchmark" to commit, same review step as any manually typed value.
   */
  autoPopulate: publicProcedure
    .input(z.object({ slug: z.string().min(1), northStar: z.enum(['shop', 'vtr', 'app_install']).optional() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireClient(ctx.db, input.slug);
      // The template being edited (not necessarily the client's own north star) picks the metric grid to average.
      return autoPopulateBenchmarksFromIndustryPeers(ctx.db, client.id, client.name, input.northStar ?? client.northStar);
    }),
});
