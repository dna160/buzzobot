/**
 * Re-export shim. The objective vocabulary moved to `@tempo/core` at Brief
 * Deck M1, because the metric catalog's grading bands and the report spec's
 * allowed-metric sets are both keyed by it and a domain kernel that cannot
 * name the objective cannot express either.
 *
 * Kept as a module rather than deleted so every existing importer
 * (`ExportDailyBriefButton.tsx`, the brief API route, `@tempo/reports`'s own
 * barrel) keeps working unchanged. The definition lives in exactly one place;
 * this file only forwards it.
 */
export { BriefObjective, OBJECTIVE_NORTH_STAR, isBriefObjective } from '@tempo/core';
