import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EngineBriefContentV2Schema,
  EngineCardCopySchema,
  EngineCoverageAuditSchema,
  EngineFindingSchema,
  EngineGeneratorGapSchema,
  EngineProbeLoopSchema,
  EngineRankedEntrySchema,
  EngineSectionEntrySchema,
  EngineSectionRankingSchema,
  EngineSectionSignalsSchema,
  parseEngineContent,
} from './engine-content.js';

/**
 * The TypeScript half of the deck boundary's drift check (Brief Deck PRD §3.1).
 *
 * The engine generates `contracts/brief_content_v2.schema.json` from its
 * Pydantic model (`scripts/export_content_schema.py`, guarded on that side by
 * `tests/test_content_schema_export.py`). This test reads that file and fails
 * when the mirror above stops matching it — a field added in Python that the
 * renderer would silently ignore, or a field removed in Python that the
 * renderer still reads.
 *
 * It reads the file directly rather than a copy because the two projects are
 * co-located: `tempo-engine/` lives inside this repo, so there is exactly one
 * schema file and no sync step to forget.
 */

const SCHEMA_PATH = fileURLToPath(
  new URL('../../../../tempo-engine/contracts/brief_content_v2.schema.json', import.meta.url),
);

interface JsonSchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
  $defs?: Record<string, JsonSchemaObject>;
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchemaObject;
const defs = schema.$defs ?? {};

const zodKeys = (s: z.ZodObject<z.ZodRawShape>): string[] => Object.keys(s.shape).sort();
const schemaKeys = (s: JsonSchemaObject): string[] => Object.keys(s.properties ?? {}).sort();

/** Every model the deck reads, paired with the Pydantic definition it mirrors. */
const MIRRORED: Array<[string, z.ZodObject<z.ZodRawShape>, JsonSchemaObject | undefined]> = [
  ['BriefContentV2', EngineBriefContentV2Schema, schema],
  ['Finding', EngineFindingSchema, defs.Finding],
  ['CardCopy', EngineCardCopySchema, defs.CardCopy],
  ['CoverageAudit', EngineCoverageAuditSchema, defs.CoverageAudit],
  ['SectionSignals', EngineSectionSignalsSchema, defs.SectionSignals],
  ['GeneratorGap', EngineGeneratorGapSchema, defs.GeneratorGap],
  ['RankedEntry', EngineRankedEntrySchema, defs.RankedEntry],
  ['SectionRankingExport', EngineSectionRankingSchema, defs.SectionRankingExport],
  ['ProbeLoopExport', EngineProbeLoopSchema, defs.ProbeLoopExport],
  ['SectionEntry', EngineSectionEntrySchema, defs.SectionEntry],
];

describe('engine content v2 mirror', () => {
  it('finds the schema the engine generates', () => {
    expect(schema.properties).toBeDefined();
  });

  it.each(MIRRORED)('mirrors %s field-for-field', (name, zodSchema, jsonSchema) => {
    expect(jsonSchema, `${name} missing from the exported schema`).toBeDefined();
    expect(zodKeys(zodSchema), `${name} fields drifted`).toEqual(schemaKeys(jsonSchema!));
  });

  it.each(MIRRORED)('keeps every required %s field non-optional', (name, zodSchema, jsonSchema) => {
    const shape = zodSchema.shape;
    for (const key of jsonSchema?.required ?? []) {
      const field = shape[key];
      expect(field, `${name}.${key} is required in Python but missing here`).toBeDefined();
      // `.default()` counts as satisfying a required field — the value is
      // always present after parsing, which is what "required" means here.
      const optionalWithoutDefault =
        field!.isOptional() && !(field instanceof z.ZodDefault) && !(field!._def as { defaultValue?: unknown }).defaultValue;
      expect(optionalWithoutDefault, `${name}.${key} is optional here but required in Python`).toBe(
        false,
      );
    }
  });
});

describe('parseEngineContent', () => {
  const v2 = {
    content_version: 2,
    tier: 'instant',
    engine_version: '0.1.0',
    brief_type: 'gmv',
    s1: { draft: { headline: 'H', summary: 'S' }, source: 'template', attempts: 0 },
    sections: {},
    s6: null,
    findings: [],
    card_copy: {},
    rankings: {},
    coverage: null,
    probe_loop: { enabled: false, probes_executed: 0, yield_rate: 0, rounds_used: 0, log: [] },
  };

  it('accepts v2 content unchanged', () => {
    const parsed = parseEngineContent(v2);
    expect(parsed.version).toBe(2);
    expect(parsed.content.tier).toBe('instant');
  });

  it('normalizes pre-M0 v1 content instead of throwing', () => {
    const parsed = parseEngineContent({
      s1: { draft: { headline: 'H', summary: 'S' }, source: 'llm', attempts: 1 },
      sections: {},
      s6: null,
      probe_loop: { enabled: true, probes_executed: 4, yield_rate: 0.5, rounds_used: 2, log: [] },
    });
    expect(parsed.version).toBe(1);
    expect(parsed.content.findings).toEqual([]);
    expect(parsed.content.probe_loop.probes_executed).toBe(4);
  });

  it('rejects a payload that matches neither version', () => {
    expect(() => parseEngineContent({ sections: 'not-an-object' })).toThrow();
  });
});
