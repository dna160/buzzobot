import {
  getDailyBriefDashboard,
  getReportSpec,
  listWindowVideos,
  type ClientSummary,
  type Database,
} from '@tempo/db';
import type { BriefObjective } from '@tempo/core';
import {
  buildDeckModel,
  parseEngineContent,
  renderDeckHtml,
  resolveReportSpec,
  type DeckModel,
  type DeckTier,
} from '@tempo/reports';

/**
 * Assembling a deck, in one place.
 *
 * Two routes need it: the synchronous brief route, and the async full-run poll
 * that renders a deck the portal kicked off earlier (Brief Deck PRD §5). They
 * must produce the *same* deck — a "full" deck that differed depending on which
 * endpoint rendered it would make the tier badge a lie — so the assembly lives
 * here rather than being written twice.
 *
 * Still no analysis: this reads read-models, resolves the spec, and hands
 * everything to `buildDeckModel`, which remains the only place engine content
 * and read-model rows meet.
 */

export interface DeckWindow {
  /** Optional explicit window end; otherwise the latest ingested day. */
  endDate?: string;
  windowDays: number;
}

export interface AssembleDeckArgs extends DeckWindow {
  db: Database;
  client: ClientSummary;
  objective: BriefObjective;
  tier: DeckTier;
  /** Raw `content` from tempo-engine — validated here, never trusted. */
  engineContent: unknown;
  /** tempo-engine's run id, printed in the provenance footer. */
  engineRunId: string;
  /** Injected so the caller can reuse a dashboard it already fetched. */
  dashboard?: Awaited<ReturnType<typeof getDailyBriefDashboard>>;
  /** ISO-8601. Passed in because `buildDeckModel` never reads a clock. */
  generatedAt?: string;
}

export interface AssembledDeck {
  model: DeckModel;
  html: string;
  periodStart: string;
  periodEnd: string;
}

/** Thrown when the client has no ingested data for the window. */
export class NoDeckDataError extends Error {
  readonly status = 404;
}

export async function assembleDeck(args: AssembleDeckArgs): Promise<AssembledDeck> {
  const { db, client, objective, tier, engineContent, engineRunId, windowDays, endDate } = args;

  const dashboard =
    args.dashboard ?? (await getDailyBriefDashboard(db, client, { endDate, windowDays }));
  if (!dashboard) {
    throw new NoDeckDataError(`No daily ad data ingested for "${client.slug}"`);
  }

  const storedSpec = await getReportSpec(db, client.id, objective);
  const spec = resolveReportSpec(storedSpec?.spec ?? null, objective, (err) =>
    console.error(`[reports] stored report_spec for ${client.slug}/${objective} rejected:`, err),
  );

  const periodStart = dashboard.days[0]?.date ?? '';
  const periodEnd = dashboard.days[dashboard.days.length - 1]?.date ?? '';

  const videos =
    spec.appendix.allVideos && periodStart && periodEnd
      ? await listWindowVideos(db, client, {
          startDate: periodStart,
          endDate: periodEnd,
        }).catch((err) => {
          // No video slide beats no deck.
          console.error(`[reports] window videos for ${client.slug} failed:`, err);
          return [];
        })
      : [];

  const parsed = parseEngineContent(engineContent);
  const model = buildDeckModel({
    content: parsed.content,
    contentVersion: parsed.version,
    dashboard,
    spec,
    objective,
    runId: engineRunId,
    tier: parsed.content.tier ?? tier,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    windowDays,
    videos,
  });

  return { model, html: renderDeckHtml(model), periodStart, periodEnd };
}
