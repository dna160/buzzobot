import { describe, expect, it } from 'vitest';
import {
  BriefObjective,
  NORTH_STAR_OBJECTIVE,
  NorthStar,
  OBJECTIVE_NORTH_STAR,
  isBriefObjective,
} from './enums.js';

describe('objective ↔ north star', () => {
  it('round-trips every objective', () => {
    for (const objective of Object.values(BriefObjective)) {
      expect(NORTH_STAR_OBJECTIVE[OBJECTIVE_NORTH_STAR[objective]]).toBe(objective);
    }
  });

  /**
   * The deprecated `/api/reports/:slug` alias (Brief Deck K5) picks a client's
   * deck from its north star. A north star with no objective would send that
   * caller to a 404 instead of the deck it used to get, so every configurable
   * north star must resolve.
   */
  it('resolves an objective for every north star a client can be configured with', () => {
    for (const northStar of Object.values(NorthStar)) {
      const objective = NORTH_STAR_OBJECTIVE[northStar];
      expect(isBriefObjective(objective)).toBe(true);
      // And the objective it resolves to is one the brief route will serve for
      // that client — its 409 gate compares exactly these two values.
      expect(OBJECTIVE_NORTH_STAR[objective]).toBe(northStar);
    }
  });

  it('maps the three north stars to the objective a client would recognise', () => {
    expect(NORTH_STAR_OBJECTIVE[NorthStar.Vtr]).toBe(BriefObjective.Awareness);
    expect(NORTH_STAR_OBJECTIVE[NorthStar.Shop]).toBe(BriefObjective.Gmv);
    expect(NORTH_STAR_OBJECTIVE[NorthStar.AppInstall]).toBe(BriefObjective.Install);
  });
});
