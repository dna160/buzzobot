import { z } from 'zod';

/**
 * The TypeScript mirror of `tempo-engine`'s `BriefContentV2`
 * (`src/engine/contracts/content.py`) — what `POST /v1/briefs/sync` and
 * `GET /v1/briefs/:run_id` return under `content`.
 *
 * Three rules this module exists to hold:
 *
 * 1. **Wire shape stays wire shape.** Fields are snake_case here because that
 *    is what the engine sends. Renaming happens exactly once, in
 *    `buildDeckModel`, so a mismatch shows up as a type error at the boundary
 *    rather than as a silently-undefined value on a slide.
 * 2. **Parse, don't trust.** `parseEngineContent` validates before anything
 *    reads a field. A brief that does not match its own contract is a 502 the
 *    route reports, not a deck with blank cards.
 * 3. **Drift is a build failure.** `engine-content.drift.test.ts` checks this
 *    file against the JSON Schema the engine generates from the Pydantic model
 *    (`tempo-engine/contracts/brief_content_v2.schema.json`). Same mechanism as
 *    the METRICS catalog port that guards the other direction of this boundary.
 *
 * v1 content (four narrated keys, no `content_version`) is still accepted by
 * `parseEngineContent` — it is the shape every brief written before this
 * milestone carries in `insight.brief`, and re-rendering an old run must not
 * throw. What v1 cannot do is fill a card, which is why the renderer branches
 * on `content_version`.
 */

export const ENGINE_CONTENT_VERSION = 2;

/** Mirrors `Direction` — whether a finding reads as good, bad, or neither. */
export const EngineDirectionSchema = z.enum(['positive', 'negative', 'neutral']);
export const EngineConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const EngineActionabilitySchema = z.enum(['high', 'medium', 'low']);
export const EngineOriginSchema = z.enum(['generator', 'probe']);
export const EngineLevelSchema = z.enum([
  'account',
  'campaign',
  'adgroup',
  'creative',
  'product',
  'creator',
  'session',
]);
export const EngineTierSchema = z.enum(['instant', 'full']);

export const EngineEntityRefSchema = z.object({
  id: z.string(),
  display_name: z.string(),
});

export const EngineComparisonSchema = z.object({
  basis: z.enum(['prior_period', 'cohort_median', 'account_baseline']),
  baseline_value: z.number(),
  current_value: z.number(),
  delta_abs: z.number(),
  delta_pct: z.number().nullable().optional(),
  label: z.string().nullable().optional(),
});

/**
 * One computed, ranked, narratable observation. `evidence` is the only place a
 * card's numbers may come from — the engine's numeral gate verified every value
 * in it, so a chip built from this dict inherits that guarantee, and a number
 * the renderer computed itself would not.
 */
export const EngineFindingSchema = z.object({
  id: z.string(),
  generator: z.string(),
  tenant_id: z.string(),
  brief_type: z.string(),
  section_affinity: z.array(z.number()),
  entity: EngineEntityRefSchema,
  level: EngineLevelSchema,
  claim_frame: z.string(),
  evidence: z.record(z.union([z.number(), z.string()])),
  // Required-but-nullable in Python (`Comparison | None` with no default), so
  // the key is always present on the wire — `.optional()` here would let a
  // payload missing it through, and the drift check says so.
  comparison: EngineComparisonSchema.nullable(),
  magnitude_pct: z.number(),
  direction: EngineDirectionSchema,
  actionability: EngineActionabilitySchema,
  confidence: EngineConfidenceSchema,
  caveats: z.array(z.string()).default([]),
  materiality: z.number(),
  provenance: z.array(z.string()).default([]),
  origin: EngineOriginSchema.default('generator'),
});

/**
 * Per-finding card prose, from the engine's closed template table (M3).
 * Deterministic in both tiers — the narrated analysis lives in the section
 * draft above the cards, so "who wrote this sentence" stays answerable.
 */
export const EngineCardCopySchema = z.object({
  headline: z.string(),
  mechanism: z.string(),
  action: z.string(),
});

export const EngineRankedEntrySchema = z.object({
  id: z.string(),
  materiality: z.number(),
});

export const EngineSectionRankingSchema = z.object({
  selected: z.array(z.string()).default([]),
  below_cut: z.array(EngineRankedEntrySchema).default([]),
});

export const EngineGeneratorGapSchema = z.object({
  generator: z.string(),
  reason: z.string(),
  missing_metrics: z.array(z.string()).default([]),
});

/** "4 dari 6 sinyal tersedia" — the counted denominator behind a coverage line. */
export const EngineSectionSignalsSchema = z.object({
  available: z.number(),
  total: z.number(),
});

export const EngineCoverageAuditSchema = z.object({
  active_day_coverage_pct: z.number().nullable().optional(),
  current_active_days: z.number().nullable().optional(),
  recency_lag_days: z.number().nullable().optional(),
  assessed_confidence: z.string().nullable().optional(),
  missing_required_metrics: z.array(z.string()).default([]),
  missing_preferred_metrics: z.array(z.string()).default([]),
  generator_gaps: z.array(EngineGeneratorGapSchema).default([]),
  signals: z.record(EngineSectionSignalsSchema).default({}),
});

export const EngineProbeLoopSchema = z.object({
  enabled: z.boolean().default(false),
  probes_executed: z.number().default(0),
  yield_rate: z.number().default(0),
  rounds_used: z.number().default(0),
  log: z.array(z.record(z.unknown())).default([]),
});

/**
 * A narrated section's draft. Deliberately loose: the engine ships two draft
 * schemas (`SectionDraftFull` / `SectionDraftLow`, where the low tier has no
 * `implication` field *at all* — Hard Rule 8), and forking that ladder here
 * would create a second definition of what a low-confidence section may say.
 */
export const EngineSectionDraftSchema = z.object({
  headline: z.string(),
  mechanism: z.string(),
  evidence_refs: z.array(z.string()).default([]),
  implication: z.string().optional(),
  action: z.string(),
  confidence: EngineConfidenceSchema,
});

export const EngineSectionEntrySchema = z.object({
  draft: EngineSectionDraftSchema,
  narration_source: z.string(),
  narration_attempts: z.number().default(0),
  critic_ok: z.boolean().nullable().optional(),
  critic_approved: z.boolean().nullable().optional(),
  critic_notes: z.string().nullable().optional(),
});

export const EngineRiskSchema = z.object({
  risk: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  action: z.string(),
  owner: z.string(),
  evidence_refs: z.array(z.string()).default([]),
});

export const EngineS1DraftSchema = z.object({
  headline: z.string(),
  summary: z.string(),
});

export const EngineS6DraftSchema = z.object({
  risks: z.array(EngineRiskSchema).default([]),
  outlook: z.array(z.string()).default([]),
  confidence: EngineConfidenceSchema,
});

export const EngineS1EntrySchema = z.object({
  draft: EngineS1DraftSchema,
  source: z.string(),
  attempts: z.number().default(0),
  fallback_reason: z.string().nullable().optional(),
});

export const EngineS6EntrySchema = z.object({
  draft: EngineS6DraftSchema,
  source: z.string(),
  attempts: z.number().default(0),
  fallback_reason: z.string().nullable().optional(),
});

export const EngineBriefContentV2Schema = z.object({
  content_version: z.literal(2),
  tier: EngineTierSchema,
  engine_version: z.string(),
  brief_type: z.string(),
  s1: EngineS1EntrySchema.nullable().optional(),
  sections: z.record(EngineSectionEntrySchema).default({}),
  s6: EngineS6EntrySchema.nullable().optional(),
  findings: z.array(EngineFindingSchema).default([]),
  // Additive since M3: an engine that predates it sends nothing, and the deck
  // falls back to the section draft for the top card rather than showing none.
  card_copy: z.record(EngineCardCopySchema).default({}),
  rankings: z.record(EngineSectionRankingSchema).default({}),
  coverage: EngineCoverageAuditSchema.nullable().optional(),
  probe_loop: EngineProbeLoopSchema.default({
    enabled: false,
    probes_executed: 0,
    yield_rate: 0,
    rounds_used: 0,
    log: [],
  }),
});

/**
 * Pre-M0 content: the four narrated keys, no version discriminator. Kept so a
 * brief already sitting in `insight.brief` can still be re-rendered — with
 * prose only, since a v1 payload carries no findings to build cards from.
 */
export const EngineBriefContentV1Schema = z.object({
  content_version: z.undefined().optional(),
  s1: EngineS1EntrySchema.nullable().optional(),
  sections: z.record(EngineSectionEntrySchema).default({}),
  s6: EngineS6EntrySchema.nullable().optional(),
  probe_loop: z
    .object({
      enabled: z.boolean().nullable().optional(),
      probes_executed: z.number().nullable().optional(),
      yield_rate: z.number().nullable().optional(),
      rounds_used: z.number().nullable().optional(),
      log: z.array(z.record(z.unknown())).nullable().optional(),
    })
    .optional(),
});

export type EngineFinding = z.infer<typeof EngineFindingSchema>;
export type EngineCardCopy = z.infer<typeof EngineCardCopySchema>;
export type EngineCoverageAudit = z.infer<typeof EngineCoverageAuditSchema>;
export type EngineSectionRanking = z.infer<typeof EngineSectionRankingSchema>;
export type EngineSectionEntry = z.infer<typeof EngineSectionEntrySchema>;
export type EngineSectionDraft = z.infer<typeof EngineSectionDraftSchema>;
export type EngineRisk = z.infer<typeof EngineRiskSchema>;
export type EngineProbeLoop = z.infer<typeof EngineProbeLoopSchema>;
export type EngineTier = z.infer<typeof EngineTierSchema>;
export type EngineBriefContentV2 = z.infer<typeof EngineBriefContentV2Schema>;
export type EngineBriefContentV1 = z.infer<typeof EngineBriefContentV1Schema>;

export interface ParsedEngineContent {
  version: 1 | 2;
  content: EngineBriefContentV2;
}

const EMPTY_PROBE_LOOP: EngineProbeLoop = {
  enabled: false,
  probes_executed: 0,
  yield_rate: 0,
  rounds_used: 0,
  log: [],
};

/**
 * Validate engine content and normalize v1 up to the v2 shape, so exactly one
 * shape reaches `buildDeckModel`. A v1 payload normalizes with empty
 * `findings` / `rankings` / `coverage` — the deck then renders its data blocks
 * and prose and simply has no cards, which is the honest rendering of a brief
 * generated before the engine exported findings.
 *
 * Throws `ZodError` when the payload matches neither version. That is
 * deliberate: a malformed brief is a boundary failure the route reports, not
 * something to paper over with defaults.
 */
export function parseEngineContent(raw: unknown): ParsedEngineContent {
  const record = raw as { content_version?: unknown } | null | undefined;
  if (record && typeof record === 'object' && record.content_version !== undefined) {
    return { version: 2, content: EngineBriefContentV2Schema.parse(raw) };
  }
  const v1 = EngineBriefContentV1Schema.parse(raw ?? {});
  return {
    version: 1,
    content: {
      content_version: 2,
      tier: 'full',
      engine_version: 'unknown',
      brief_type: '',
      s1: v1.s1 ?? null,
      sections: v1.sections ?? {},
      s6: v1.s6 ?? null,
      findings: [],
      card_copy: {},
      rankings: {},
      coverage: null,
      probe_loop: {
        ...EMPTY_PROBE_LOOP,
        enabled: v1.probe_loop?.enabled ?? false,
        probes_executed: v1.probe_loop?.probes_executed ?? 0,
        yield_rate: v1.probe_loop?.yield_rate ?? 0,
        rounds_used: v1.probe_loop?.rounds_used ?? 0,
        log: v1.probe_loop?.log ?? [],
      },
    },
  };
}

/** Findings a section may narrate, in the engine's own ranked order. */
export function selectedFindings(
  content: EngineBriefContentV2,
  sectionId: number,
): EngineFinding[] {
  const ids = content.rankings[String(sectionId)]?.selected ?? [];
  const byId = new Map(content.findings.map((f) => [f.id, f]));
  return ids.map((id) => byId.get(id)).filter((f): f is EngineFinding => f !== undefined);
}
