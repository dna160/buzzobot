import { NorthStar } from '@tempo/core';

/**
 * The three client-facing "brief" report types, each scoring a client's
 * TikTok Ads data on a different objective. Deliberately a request-time
 * choice, not a fixed client property: which briefs a given client's data
 * can honestly support is enforced separately (see the API route's
 * north-star gating), not baked into this type.
 *
 * Generation itself now lives in `tempo-engine` (a separate Python
 * service) — see `apps/web/src/app/api/reports/[slug]/brief/[objective]/route.ts`
 * and `engine-brief/render.ts`. This module only keeps the small,
 * generically useful vocabulary (objective names, north-star mapping,
 * the type guard) that both the route and `ExportDailyBriefButton.tsx`
 * still need.
 */
export const BriefObjective = {
  Awareness: 'awareness',
  Gmv: 'gmv',
  Install: 'install',
} as const;
export type BriefObjective = (typeof BriefObjective)[keyof typeof BriefObjective];

export const OBJECTIVE_NORTH_STAR: Record<BriefObjective, NorthStar> = {
  [BriefObjective.Awareness]: NorthStar.Vtr,
  [BriefObjective.Gmv]: NorthStar.Shop,
  [BriefObjective.Install]: NorthStar.AppInstall,
};

export function isBriefObjective(v: string): v is BriefObjective {
  return v === BriefObjective.Awareness || v === BriefObjective.Gmv || v === BriefObjective.Install;
}
