import type { Covered } from './coverage';

/**
 * A player's season totals and career as the data provider counts them
 * (T-1431, D-223), beside -- never mixed into -- the record we compute from
 * the matches we ingest (`PlayerPage.record`, D-038).
 */

/** One season with one team in one competition, in the provider's numbers. */
export interface PlayerProviderSeasonLine {
  /**
   * `year` is the year the season starts in; `label` is our catalogue's name
   * for that season of the competition ("2026/27"), or `null` when we hold no
   * such season.
   */
  season: { year: number; label: string | null };
  competition: { id: string; name: string; short_name: string | null };
  team: { id: string; name: string; short_name: string | null };
  /**
   * Our own record holds this player's line-ups in this competition's season
   * (`PlayerPage.record`), so ours is the authoritative figure: the
   * provider's line is not shown beside it, and never summed with it.
   */
  counted_by_us: boolean;
  /** Always at least one: a season without an appearance is not listed. */
  appearances: number;
  /** A count the provider left out is `null`, never zero (rule 3). */
  starts: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellow_cards: number | null;
  /** Sent off for a second yellow card. */
  second_yellow_cards: number | null;
  /** Sent off with a straight red card. */
  red_cards: number | null;
  /** A goalkeeper's; `null` for everyone else. */
  saves: number | null;
  goals_conceded: number | null;
  /** The provider's average match rating, 0 to 10, two places. */
  rating: number | null;
}

/** A club or national team the player was at, and the seasons, newest first. */
export interface PlayerProviderCareerTeam {
  team: { id: string; name: string; short_name: string | null };
  /** The years those seasons start in, newest first. */
  season_years: number[];
}

/**
 * `GET /players/:id/provider-seasons`. Each part is `not_supplied` until the
 * provider has been asked about this player, `limited` when its answer named
 * competitions or teams our catalogue does not hold (left out and counted in
 * `unlisted`, never shown under a name alone), and `available` otherwise.
 */
export interface PlayerProviderSeasons {
  /** Who counted these numbers, for the page to say so ("API-Football"). */
  source_name: string;
  /** The latest season the provider was asked about. */
  seasons: Covered<{ lines: PlayerProviderSeasonLine[]; unlisted: number }>;
  career: Covered<{ teams: PlayerProviderCareerTeam[]; unlisted: number }>;
}
