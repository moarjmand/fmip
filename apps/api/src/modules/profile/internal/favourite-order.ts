import type { FavouriteIds } from '@fmip/contracts';

/**
 * How favourites and follows order a list of fixtures (blueprint 4.1:
 * "favourite teams and major fixtures can be pinned above the standard
 * list"). Pure, so the scores API (T-030) can sort with it and this module
 * can test it without a fixture table.
 *
 * Rank, lowest first:
 *   0  a favourite team is playing
 *   1  a favourite competition
 *   2  a followed (not favourite) team is playing
 *   3  a followed competition
 *   4  everything else
 * Ties break on kick-off, earliest first, then on the id for stability.
 */
export interface RankableFixture {
  id: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** ISO 8601. */
  kickoffAt: string;
}

export function favouriteRank(fixture: RankableFixture, prefs: FavouriteIds): number {
  const teams = [fixture.homeTeamId, fixture.awayTeamId];

  if (teams.some((id) => prefs.team_ids.includes(id))) return 0;
  if (prefs.competition_ids.includes(fixture.competitionId)) return 1;
  if (teams.some((id) => prefs.followed_team_ids.includes(id))) return 2;
  if (prefs.followed_competition_ids.includes(fixture.competitionId)) return 3;
  return 4;
}

export function compareByFavourites(prefs: FavouriteIds) {
  return (a: RankableFixture, b: RankableFixture): number => {
    const rank = favouriteRank(a, prefs) - favouriteRank(b, prefs);
    if (rank !== 0) return rank;

    const time = Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt);
    if (time !== 0) return time;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export const NO_FAVOURITES: FavouriteIds = {
  team_ids: [],
  competition_ids: [],
  person_ids: [],
  followed_team_ids: [],
  followed_competition_ids: [],
};
