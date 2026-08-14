import { z } from 'zod';

/**
 * The narrative the model produces. Deliberately mirrors the deterministic
 * analysis shape one-for-one, so a generated report and a fallback report are
 * structurally identical — only the wording differs. That keeps the renderer
 * unaware of which path produced the text, and makes the fallback a true
 * drop-in rather than a degraded layout.
 */
// Max lengths are generous headroom, not targets: the prompt asks the model to
// write tight, skimmable prose, but a sharper narrative runs longer than a terse
// one, and a whole report should not be rejected because one callout ran a
// sentence over. Every field here flows as text in a page-break-safe card, so a
// longer string only makes a card taller — never breaks the layout.
export const FindingSchema = z.object({
  title: z.string().min(3).max(100),
  body: z.string().min(20).max(900),
  tone: z.enum(['insight', 'warning', 'risk']),
});

export const RiskSchema = z.object({
  // Risk statements carry their own evidence (an hour, a campaign name, a
  // figure), and campaign names here run long, so the ceiling is set well
  // above the two-sentence target the prompt asks for.
  risk: z.string().min(10).max(500),
  severity: z.enum(['high', 'medium', 'low']),
  action: z.string().min(8).max(500),
  owner: z.string().min(2).max(60),
});

export const NarrativeSchema = z.object({
  /** One sentence stating the single most important thing in the data. */
  headline: z.string().min(20).max(300),
  summaryProse: z.string().min(50).max(1500),
  daypart: z.object({ finding: FindingSchema, prose: z.string().min(30).max(1100) }).nullable(),
  efficiency: z.object({ finding: FindingSchema, prose: z.string().min(30).max(1100) }).nullable(),
  mix: z.object({ finding: FindingSchema, prose: z.string().min(30).max(1100) }).nullable(),
  adgroup: z.object({ finding: FindingSchema, prose: z.string().min(30).max(1100) }).nullable(),
  dataGap: FindingSchema,
  // Section 7 is the deliverable a brand manager acts on, so a thin register is
  // a failed report, not a stylistic choice. The deterministic fallback also
  // clears this floor, so a model that cannot is correctly rejected.
  risks: z.array(RiskSchema).min(6).max(9),
  outlook: z.array(z.string().min(20).max(700)).min(1).max(5),
  confidence: z.enum(['High', 'Medium', 'Low']),
});

export type Narrative = z.infer<typeof NarrativeSchema>;

/** JSON Schema form, for providers that constrain output by schema. */
export const NARRATIVE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headline',
    'summaryProse',
    'daypart',
    'efficiency',
    'mix',
    'adgroup',
    'dataGap',
    'risks',
    'outlook',
    'confidence',
  ],
  properties: {
    headline: { type: 'string' },
    summaryProse: { type: 'string' },
    daypart: { $ref: '#/$defs/section' },
    efficiency: { $ref: '#/$defs/section' },
    mix: { $ref: '#/$defs/section' },
    adgroup: { $ref: '#/$defs/section' },
    dataGap: { $ref: '#/$defs/finding' },
    risks: {
      type: 'array',
      minItems: 6,
      maxItems: 9,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['risk', 'severity', 'action', 'owner'],
        properties: {
          risk: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          action: { type: 'string' },
          owner: { type: 'string' },
        },
      },
    },
    outlook: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
  },
  $defs: {
    finding: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body', 'tone'],
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        tone: { type: 'string', enum: ['insight', 'warning', 'risk'] },
      },
    },
    section: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['finding', 'prose'],
          properties: { finding: { $ref: '#/$defs/finding' }, prose: { type: 'string' } },
        },
        { type: 'null' },
      ],
    },
  },
} as const;
