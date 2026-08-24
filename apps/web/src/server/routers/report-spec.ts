import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { isBriefObjective, type BriefObjective } from '@tempo/core';
import { deleteReportSpec, getClientBySlug, getReportSpec, upsertReportSpec } from '@tempo/db';
import {
  OBJECTIVE_NORTH_STAR,
  ReportSpecObjectiveError,
  ReportSpecSchema,
  defaultReportSpec,
  paletteFor,
  parseReportSpec,
  previewSpec,
  resolveReportSpec,
} from '@tempo/reports';
import { router, publicProcedure } from '../trpc.js';

/**
 * The report spec editor's API (Brief Deck PRD §3.3, M6).
 *
 * Every validation rule comes from `@tempo/reports` — `parseReportSpec` is the
 * same function the export path calls. Restating "an awareness deck cannot show
 * ROAS" here (or in the client) would create a second definition of the rule,
 * and the one that eventually drifts is the one nobody is looking at.
 */

const ObjectiveInput = z.string().refine(isBriefObjective, {
  message: 'objective must be awareness, gmv, or install',
});

async function requireClient(db: Parameters<typeof getClientBySlug>[0], slug: string) {
  const client = await getClientBySlug(db, slug);
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: `Client "${slug}" not found` });
  }
  return client;
}

export const reportSpecRouter = router({
  /**
   * The spec an AM is editing, plus everything the editor needs to render:
   * the palette for this objective and the grid the spec currently produces.
   *
   * Absent means the preset, exactly as the export resolves it — the editor
   * opens on what the client is actually getting today, not on a blank slate.
   */
  get: publicProcedure
    .input(z.object({ slug: z.string().min(1), objective: ObjectiveInput }))
    .query(async ({ ctx, input }) => {
      const objective = input.objective as BriefObjective;
      const client = await requireClient(ctx.db, input.slug);

      const stored = await getReportSpec(ctx.db, client.id, objective);
      const spec = resolveReportSpec(stored?.spec ?? null, objective);

      return {
        client: { id: client.id, name: client.name, slug: client.slug, northStar: client.northStar },
        objective,
        /** Whether this objective is honest for this client (the route's 409 gate). */
        availableForClient:
          objective === 'awareness' || client.northStar === OBJECTIVE_NORTH_STAR[objective],
        spec,
        isStored: stored !== null,
        updatedAt: stored?.updatedAt.toISOString() ?? null,
        preset: defaultReportSpec(objective),
        palette: paletteFor(objective, spec),
        preview: previewSpec(spec, objective),
      };
    }),

  /**
   * Save a spec. A malformed one is a 400; one that contradicts its objective
   * is a 422 carrying the offending metrics, so the editor can point at them
   * instead of saying "invalid".
   */
  save: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
        objective: ObjectiveInput,
        spec: ReportSpecSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const objective = input.objective as BriefObjective;
      const client = await requireClient(ctx.db, input.slug);

      let spec;
      try {
        spec = parseReportSpec(input.spec, objective);
      } catch (error) {
        if (error instanceof ReportSpecObjectiveError) {
          throw new TRPCError({
            code: 'UNPROCESSABLE_CONTENT',
            message: error.message,
            cause: error,
          });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: (error as Error).message });
      }

      await upsertReportSpec(ctx.db, client.id, objective, spec);
      // The next deck — including the next pre-generated one — uses it.
      return { ok: true as const, spec, preview: previewSpec(spec, objective) };
    }),

  /** Drop the stored spec; the client falls back to the objective preset. */
  reset: publicProcedure
    .input(z.object({ slug: z.string().min(1), objective: ObjectiveInput }))
    .mutation(async ({ ctx, input }) => {
      const objective = input.objective as BriefObjective;
      const client = await requireClient(ctx.db, input.slug);
      await deleteReportSpec(ctx.db, client.id, objective);
      return { ok: true as const, spec: defaultReportSpec(objective) };
    }),
});
